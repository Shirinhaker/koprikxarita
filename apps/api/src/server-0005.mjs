import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createKoprikServer } from "./server.mjs";
import { authenticateRequest, createToken } from "./auth.mjs";
import { JsonRoadRepository } from "../../../src/storage/json-road-repository.mjs";
import { JsonBuildingRepository } from "../../../src/storage/json-building-repository.mjs";

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return {}; }
}

function requireAdmin(request, response, jwtSecret) {
  const user = authenticateRequest(request, jwtSecret);
  if (!user) {
    sendJson(response, 401, { code: "AUTH_REQUIRED", message: "Kirish talab qilinadi" });
    return null;
  }
  if (user.role !== "admin") {
    sendJson(response, 403, { code: "FORBIDDEN", message: "Bu amal uchun administrator huquqi kerak" });
    return null;
  }
  return user;
}

export function resolveStoragePaths({ projectRoot, env = process.env }) {
  const roadsFile = env.ROADS_FILE ?? path.join(projectRoot, "data/roads.json");
  const roadLogFile = env.ROAD_LOG_FILE ?? path.join(projectRoot, "data/road-change-log.json");
  const sharedDataDir = path.dirname(roadsFile);
  return {
    roadsFile,
    roadLogFile,
    buildingsFile: env.BUILDINGS_FILE ?? path.join(sharedDataDir, "buildings.json"),
    buildingLogFile: env.BUILDING_LOG_FILE ?? path.join(sharedDataDir, "building-change-log.json"),
  };
}

function emptyImportStatus() {
  return {
    state: "idle",
    imported: 0,
    currentTile: 0,
    totalTiles: 0,
    existingMicrosoft: 0,
    startedAt: null,
    finishedAt: null,
    error: null,
    message: null,
  };
}

export class MicrosoftImportProcessManager {
  constructor({ buildingRepository, jwtSecret, projectRoot, getApiBase, spawnImpl = spawn }) {
    this.buildingRepository = buildingRepository;
    this.jwtSecret = jwtSecret;
    this.projectRoot = projectRoot;
    this.getApiBase = getApiBase;
    this.spawnImpl = spawnImpl;
    this.status = emptyImportStatus();
    this.child = null;
  }

  getStatus() { return { ...this.status }; }

  async start(actor, { force = false } = {}) {
    if (this.status.state === "running") return { started: false, status: this.getStatus() };

    const allBuildings = await this.buildingRepository.list("all");
    const existingMicrosoft = allBuildings.filter((building) => building.source === "microsoft" && building.status !== "archived").length;
    if (existingMicrosoft > 0 && !force) {
      this.status = {
        ...emptyImportStatus(),
        state: "completed",
        imported: existingMicrosoft,
        existingMicrosoft,
        message: "Microsoft binolari allaqachon mavjud. Takroriy import bloklandi.",
        finishedAt: new Date().toISOString(),
      };
      return { started: false, status: this.getStatus() };
    }

    this.status = { ...emptyImportStatus(), state: "running", startedAt: new Date().toISOString() };
    const token = createToken(actor, this.jwtSecret, 60 * 60 * 24);
    const args = [
      path.join(this.projectRoot, "scripts/import-microsoft-buildings.mjs"),
      "--api", this.getApiBase(),
      "--token", token,
      "--bbox", "66.1,36.9,68.7,38.7",
      "--batch", "1000",
    ];
    this.child = this.spawnImpl(process.execPath, args, { cwd: this.projectRoot, stdio: ["ignore", "pipe", "pipe"] });

    const handleOutput = (chunk) => {
      const text = String(chunk);
      const tileMatch = [...text.matchAll(/\[(\d+)\/(\d+)\]\s+tayl/g)].at(-1);
      if (tileMatch) {
        this.status.currentTile = Number(tileMatch[1]);
        this.status.totalTiles = Number(tileMatch[2]);
      }
      const countMatch = [...text.matchAll(/topildi:\s*(\d+)/g)].at(-1);
      if (countMatch) this.status.imported = Number(countMatch[1]);
      const finalMatch = /Tayyor\.\s*(\d+)\s*ta bino\s*import qilindi/.exec(text);
      if (finalMatch) this.status.imported = Number(finalMatch[1]);
    };
    this.child.stdout?.on("data", handleOutput);
    this.child.stderr?.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) this.status.error = text.slice(-1000);
    });
    this.child.on("error", (error) => {
      this.status.state = "failed";
      this.status.error = error.message;
      this.status.finishedAt = new Date().toISOString();
    });
    this.child.on("close", (code) => {
      if (this.status.state === "failed") return;
      this.status.state = code === 0 ? "completed" : "failed";
      if (code !== 0 && !this.status.error) this.status.error = `Import jarayoni ${code} kodi bilan tugadi`;
      this.status.finishedAt = new Date().toISOString();
    });

    return { started: true, status: this.getStatus() };
  }
}

export function createImportAwareServer({ baseRequestHandler, buildingImportManager, jwtSecret }) {
  if (typeof baseRequestHandler !== "function") throw new TypeError("base request handler kerak");
  if (!buildingImportManager) throw new TypeError("building import manager kerak");
  if (!jwtSecret) throw new TypeError("jwtSecret kerak");

  return http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const pathname = decodeURIComponent(url.pathname);

    if (request.method === "GET" && pathname === "/api/buildings/import-microsoft/status") {
      const user = requireAdmin(request, response, jwtSecret);
      if (!user) return;
      return sendJson(response, 200, { status: buildingImportManager.getStatus() });
    }

    if (request.method === "POST" && pathname === "/api/buildings/import-microsoft") {
      const user = requireAdmin(request, response, jwtSecret);
      if (!user) return;
      const body = await readJsonBody(request);
      const result = await buildingImportManager.start(user, { force: body.force === true });
      return sendJson(response, 202, result);
    }

    return baseRequestHandler(request, response);
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
  const jwtSecret = process.env.JWT_SECRET ?? "development-only-secret-change-me";
  const storage = resolveStoragePaths({ projectRoot, env: process.env });
  const repository = new JsonRoadRepository({ roadsFile: storage.roadsFile, logFile: storage.roadLogFile });
  const buildingRepository = new JsonBuildingRepository({ buildingsFile: storage.buildingsFile, logFile: storage.buildingLogFile });
  const baseServer = createKoprikServer({
    repository,
    buildingRepository,
    jwtSecret,
    publicDir: path.join(projectRoot, "apps/web/public"),
    users: defaultUsers(),
    webOrigin: process.env.WEB_ORIGIN ?? "*",
  });
  const [baseRequestHandler] = baseServer.listeners("request");
  let server;
  const buildingImportManager = new MicrosoftImportProcessManager({
    buildingRepository,
    jwtSecret,
    projectRoot,
    getApiBase: () => `http://127.0.0.1:${server.address().port}/api`,
  });
  server = createImportAwareServer({ baseRequestHandler, buildingImportManager, jwtSecret });
  const port = Number(process.env.PORT ?? 4100);
  server.listen(port, "0.0.0.0", () => console.log(`Ko‘prik Xarita BUILD 0005: http://localhost:${port}`));
}
