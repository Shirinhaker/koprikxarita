import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticateRequest, createToken } from "./auth.mjs";
import { isInsideSurxondaryo, RoadValidationError, toFeatureCollection } from "../../../src/domain/roads.mjs";
import {
  JsonRoadRepository,
  RoadConflictError,
  RoadNotFoundError,
  RoadPublishError,
} from "../../../src/storage/json-road-repository.mjs";
import {
  BuildingValidationError,
  isInsideSurxondaryo as isBuildingInsideSurxondaryo,
  toFeatureCollection as buildingsToFeatureCollection,
} from "../../../src/domain/buildings.mjs";
import {
  JsonBuildingRepository,
  BuildingConflictError,
  BuildingNotFoundError,
  BuildingPublishError,
} from "../../../src/storage/json-building-repository.mjs";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function sendJson(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...headers,
  });
  response.end(body);
}

async function readJsonBody(request, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("So‘rov hajmi juda katta");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("JSON formati noto‘g‘ri");
    error.code = "INVALID_JSON";
    throw error;
  }
}

function requireUser(request, response, secret, role = undefined) {
  const user = authenticateRequest(request, secret);
  if (!user) {
    sendJson(response, 401, { code: "AUTH_REQUIRED", message: "Kirish talab qilinadi" });
    return null;
  }
  if (role && user.role !== role) {
    sendJson(response, 403, { code: "FORBIDDEN", message: "Bu amal uchun ruxsat yo‘q" });
    return null;
  }
  return user;
}

function errorResponse(response, error) {
  if (error instanceof RoadValidationError) {
    return sendJson(response, 422, { code: error.code, message: error.message, details: error.details });
  }
  if (error instanceof RoadConflictError) {
    return sendJson(response, 409, { code: error.code, message: error.message });
  }
  if (error instanceof RoadNotFoundError) {
    return sendJson(response, 404, { code: error.code, message: error.message });
  }
  if (error instanceof RoadPublishError) {
    return sendJson(response, 422, { code: error.code, message: error.message });
  }
  if (error instanceof BuildingValidationError) {
    return sendJson(response, 422, { code: error.code, message: error.message, details: error.details });
  }
  if (error instanceof BuildingConflictError) {
    return sendJson(response, 409, { code: error.code, message: error.message });
  }
  if (error instanceof BuildingNotFoundError) {
    return sendJson(response, 404, { code: error.code, message: error.message });
  }
  if (error instanceof BuildingPublishError) {
    return sendJson(response, 422, { code: error.code, message: error.message });
  }
  if (error?.code === "BODY_TOO_LARGE") {
    return sendJson(response, 413, { code: error.code, message: error.message });
  }
  if (error?.code === "INVALID_JSON") {
    return sendJson(response, 400, { code: error.code, message: error.message });
  }
  console.error(error);
  return sendJson(response, 500, { code: "SERVER_ERROR", message: "Serverda kutilmagan xato yuz berdi" });
}

async function serveStatic(response, publicDir, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(publicDir, relative);
  const publicRoot = path.resolve(publicDir);
  if (!resolved.startsWith(`${publicRoot}${path.sep}`) && resolved !== path.join(publicRoot, "index.html")) {
    sendJson(response, 403, { message: "Ruxsat yo‘q" });
    return;
  }

  let filePath = resolved;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, "index.html");
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "content-length": body.length,
      "cache-control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
    });
    response.end(body);
  } catch (error) {
    if (error.code === "ENOENT") {
      const fallback = path.join(publicRoot, "index.html");
      try {
        const body = await readFile(fallback);
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": body.length });
        response.end(body);
      } catch {
        sendJson(response, 404, { message: "Sahifa topilmadi" });
      }
      return;
    }
    throw error;
  }
}

export function createKoprikServer({ repository, buildingRepository, jwtSecret, publicDir, users, webOrigin = "*" }) {
  if (!repository) throw new Error("repository kerak");
  if (!jwtSecret) throw new Error("jwtSecret kerak");

  return http.createServer(async (request, response) => {
    const originHeaders = {
      "access-control-allow-origin": webOrigin,
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    };
    for (const [key, value] of Object.entries(originHeaders)) response.setHeader(key, value);
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-frame-options", "SAMEORIGIN");
    response.setHeader("referrer-policy", "strict-origin-when-cross-origin");

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", "http://localhost");
    const pathname = decodeURIComponent(url.pathname);

    try {
      if (request.method === "GET" && pathname === "/api/health") {
        return sendJson(response, 200, { ok: true, service: "koprik-xarita" });
      }

      if (request.method === "POST" && pathname === "/api/auth/login") {
        const body = await readJsonBody(request);
        const user = users.find((candidate) => candidate.login === String(body.login ?? "").trim());
        if (!user || user.password !== body.password) {
          return sendJson(response, 401, { code: "LOGIN_INVALID", message: "Login yoki parol noto‘g‘ri" });
        }
        return sendJson(response, 200, {
          token: createToken(user, jwtSecret),
          user: { id: user.id, fullName: user.fullName, role: user.role },
        });
      }

      if (request.method === "POST" && pathname === "/api/auth/logout") {
        return sendJson(response, 200, { ok: true });
      }

      if (request.method === "GET" && pathname === "/api/auth/me") {
        const user = requireUser(request, response, jwtSecret);
        if (!user) return;
        return sendJson(response, 200, { user });
      }

      if (request.method === "GET" && pathname === "/api/roads/search") {
        const user = authenticateRequest(request, jwtSecret);
        const requestedStatus = url.searchParams.get("status") ?? "published";
        const status = user?.role === "admin" ? requestedStatus : "published";
        const roads = await repository.search(url.searchParams.get("q") ?? "", status);
        return sendJson(response, 200, { roads, geojson: toFeatureCollection(roads) });
      }

      if (request.method === "GET" && pathname === "/api/roads") {
        const user = authenticateRequest(request, jwtSecret);
        const requestedStatus = url.searchParams.get("status") ?? "published";
        const status = user?.role === "admin" ? requestedStatus : "published";
        const roads = await repository.list(status);
        return sendJson(response, 200, { roads, geojson: toFeatureCollection(roads) });
      }

      const idMatch = /^\/api\/roads\/([^/]+)$/.exec(pathname);
      if (request.method === "GET" && idMatch) {
        const road = await repository.getById(idMatch[1]);
        const user = authenticateRequest(request, jwtSecret);
        if (!road || (road.status !== "published" && user?.role !== "admin")) {
          throw new RoadNotFoundError();
        }
        return sendJson(response, 200, { road });
      }

      if (request.method === "POST" && pathname === "/api/roads") {
        const user = requireUser(request, response, jwtSecret, "admin");
        if (!user) return;
        const input = await readJsonBody(request);
        const road = await repository.create(input, user);
        const warnings = isInsideSurxondaryo(road.geometry) ? [] : ["Ko‘cha Surxondaryo chegarasidan tashqarida bo‘lishi mumkin"];
        return sendJson(response, 201, { ...road, warnings });
      }

      if (request.method === "PUT" && idMatch) {
        const user = requireUser(request, response, jwtSecret, "admin");
        if (!user) return;
        const road = await repository.update(idMatch[1], await readJsonBody(request), user);
        return sendJson(response, 200, road);
      }

      if (request.method === "DELETE" && idMatch) {
        const user = requireUser(request, response, jwtSecret, "admin");
        if (!user) return;
        return sendJson(response, 200, await repository.archive(idMatch[1], user));
      }

      const actionMatch = /^\/api\/roads\/([^/]+)\/(publish|restore)$/.exec(pathname);
      if (request.method === "POST" && actionMatch) {
        const user = requireUser(request, response, jwtSecret, "admin");
        if (!user) return;
        const [, id, action] = actionMatch;
        const road = action === "publish" ? await repository.publish(id, user) : await repository.restore(id, user);
        return sendJson(response, 200, road);
      }

      // ===== Binolar (buildings) — yo‘llar bilan bir xil naqsh =====
      if (buildingRepository && pathname.startsWith("/api/buildings")) {
        if (request.method === "GET" && pathname === "/api/buildings/search") {
          const user = authenticateRequest(request, jwtSecret);
          const requestedStatus = url.searchParams.get("status") ?? "published";
          const status = user?.role === "admin" ? requestedStatus : "published";
          const buildings = await buildingRepository.search(url.searchParams.get("q") ?? "", status);
          return sendJson(response, 200, { buildings, geojson: buildingsToFeatureCollection(buildings) });
        }

        if (request.method === "GET" && pathname === "/api/buildings") {
          const user = authenticateRequest(request, jwtSecret);
          const requestedStatus = url.searchParams.get("status") ?? "published";
          const status = user?.role === "admin" ? requestedStatus : "published";
          const buildings = await buildingRepository.list(status);
          return sendJson(response, 200, { buildings, geojson: buildingsToFeatureCollection(buildings) });
        }

        if (request.method === "POST" && pathname === "/api/buildings/import") {
          const user = requireUser(request, response, jwtSecret, "admin");
          if (!user) return;
          const body = await readJsonBody(request, 32 * 1024 * 1024);
          const items = Array.isArray(body?.buildings) ? body.buildings : [];
          if (items.length === 0) {
            return sendJson(response, 422, { code: "BUILDING_IMPORT_EMPTY", message: "Import uchun binolar yuborilmadi" });
          }
          const result = await buildingRepository.importMany(items, user, { source: body.source ?? "manual" });
          return sendJson(response, 201, result);
        }

        if (request.method === "POST" && pathname === "/api/buildings") {
          const user = requireUser(request, response, jwtSecret, "admin");
          if (!user) return;
          const building = await buildingRepository.create(await readJsonBody(request), user);
          const warnings = isBuildingInsideSurxondaryo(building.geometry) ? [] : ["Bino Surxondaryo chegarasidan tashqarida bo‘lishi mumkin"];
          return sendJson(response, 201, { ...building, warnings });
        }

        const bIdMatch = /^\/api\/buildings\/([^/]+)$/.exec(pathname);
        if (request.method === "GET" && bIdMatch) {
          const building = await buildingRepository.getById(bIdMatch[1]);
          const user = authenticateRequest(request, jwtSecret);
          if (!building || (building.status !== "published" && user?.role !== "admin")) {
            throw new BuildingNotFoundError();
          }
          return sendJson(response, 200, { building });
        }

        if (request.method === "PUT" && bIdMatch) {
          const user = requireUser(request, response, jwtSecret, "admin");
          if (!user) return;
          const building = await buildingRepository.update(bIdMatch[1], await readJsonBody(request), user);
          return sendJson(response, 200, building);
        }

        if (request.method === "DELETE" && bIdMatch) {
          const user = requireUser(request, response, jwtSecret, "admin");
          if (!user) return;
          return sendJson(response, 200, await buildingRepository.archive(bIdMatch[1], user));
        }

        const bActionMatch = /^\/api\/buildings\/([^/]+)\/(publish|restore|verify|unverify)$/.exec(pathname);
        if (request.method === "POST" && bActionMatch) {
          const user = requireUser(request, response, jwtSecret, "admin");
          if (!user) return;
          const [, id, action] = bActionMatch;
          let building;
          if (action === "publish") building = await buildingRepository.publish(id, user);
          else if (action === "restore") building = await buildingRepository.restore(id, user);
          else building = await buildingRepository.setVerified(id, action === "verify", user);
          return sendJson(response, 200, building);
        }
      }

      if (pathname.startsWith("/api/")) {
        return sendJson(response, 404, { code: "NOT_FOUND", message: "API manzili topilmadi" });
      }

      await serveStatic(response, publicDir, pathname);
    } catch (error) {
      errorResponse(response, error);
    }
  });
}

function defaultUsers() {
  return [
    {
      id: "admin-local",
      fullName: "Bosh administrator",
      login: process.env.ADMIN_LOGIN ?? "admin",
      password: process.env.ADMIN_PASSWORD ?? "admin12345",
      role: "admin",
    },
    {
      id: "viewer-local",
      fullName: "Oddiy foydalanuvchi",
      login: "viewer",
      password: "viewer12345",
      role: "viewer",
    },
  ];
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  const projectRoot = path.resolve(path.dirname(currentFile), "../../..");
  const repository = new JsonRoadRepository({
    roadsFile: process.env.ROADS_FILE ?? path.join(projectRoot, "data/roads.json"),
    logFile: process.env.ROAD_LOG_FILE ?? path.join(projectRoot, "data/road-change-log.json"),
  });
  const buildingRepository = new JsonBuildingRepository({
    buildingsFile: process.env.BUILDINGS_FILE ?? path.join(projectRoot, "data/buildings.json"),
    logFile: process.env.BUILDING_LOG_FILE ?? path.join(projectRoot, "data/building-change-log.json"),
  });
  const server = createKoprikServer({
    repository,
    buildingRepository,
    jwtSecret: process.env.JWT_SECRET ?? "development-only-secret-change-me",
    publicDir: path.join(projectRoot, "apps/web/public"),
    users: defaultUsers(),
    webOrigin: process.env.WEB_ORIGIN ?? "*",
  });
  const port = Number(process.env.PORT ?? 4100);
  server.listen(port, "0.0.0.0", () => {
    console.log(`Ko‘prik Xarita: http://localhost:${port}`);
    console.log("Admin: admin / admin12345 (faqat lokal ishlab chiqish uchun)");
  });
}
