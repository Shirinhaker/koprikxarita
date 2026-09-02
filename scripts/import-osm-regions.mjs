#!/usr/bin/env node
//
// Surxondaryo tumanlarining chegaralarini OpenStreetMap'dan yuklab,
// /api/regions/import ga yuboradi.
//
// Ishlatish:
//   npm run import-regions -- --login admin:admin12345 --dry-run
//   npm run import-regions -- --login admin:admin12345
//
// Bayroqlar:
//   --api <manzil>      standart: http://localhost:4100/api
//   --login user:parol  token o'rniga (avval login qiladi)
//   --token <token>     tayyor token
//   --level tuman       hozircha faqat "tuman" qo'llanadi (OSM admin_level=6)
//   --tolerance 0.0002  geometriyani soddalashtirish (daraja). 0 — soddalashtirmaslik
//   --dry-run           serverga yozmasdan, faqat nima kelishini ko'rsatadi
//   --out <fayl>        yuklangan GeoJSON'ni faylga ham yozadi
//
// Nega bu skript kerak: mahalla chegaralari OSM'da deyarli yo'q (Surxondaryo
// bo'yicha atigi 3 ta), tuman chegaralari esa 14 tasi ham to'liq. Shuning
// uchun tumanlar avtomatik olinadi, mahalla esa qo'lda chiziladi.

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

// Surxondaryo viloyati — OSM relation. admin_level=4.
const SURXONDARYO_RELATION_ID = 196248;

// OSM admin_level -> loyihadagi daraja.
const LEVEL_BY_ADMIN_LEVEL = { 6: "tuman", 9: "mahalla", 10: "mahalla" };

function parseArgs(argv) {
  const args = { api: "http://localhost:4100/api", level: "tuman", tolerance: 0.0002 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--dry-run") { args.dryRun = true; continue; }
    const value = argv[i + 1];
    if (key === "--api") args.api = value;
    else if (key === "--token") args.token = value;
    else if (key === "--login") args.login = value;
    else if (key === "--level") args.level = value;
    else if (key === "--tolerance") args.tolerance = Number(value);
    else if (key === "--out") args.out = value;
    else continue;
    i += 1;
  }
  return args;
}

function adminLevelsFor(level) {
  return Object.entries(LEVEL_BY_ADMIN_LEVEL)
    .filter(([, mapped]) => mapped === level)
    .map(([adminLevel]) => adminLevel);
}

function buildQuery(level) {
  const levels = adminLevelsFor(level);
  if (levels.length === 0) throw new Error(`Noma'lum daraja: ${level}`);
  return `[out:json][timeout:180];
rel(${SURXONDARYO_RELATION_ID});map_to_area->.su;
rel(area.su)["boundary"="administrative"]["admin_level"~"^(${levels.join("|")})$"];
out geom;`;
}

// Overpass ochiq va bepul xizmat — so'rov cheklanishi odatiy hol.
// Shuning uchun bir nechta oyna sinaladi va kutish vaqti oshirib boriladi.
async function fetchOverpass(query) {
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(endpoint, { method: "POST", body: query });
        const text = await response.text();
        if (!response.ok || text.trimStart().startsWith("<")) {
          const limited = /rate_limited|too many requests/i.test(text);
          throw new Error(limited ? "Overpass so'rovni cheklab qo'ydi" : `Overpass HTTP ${response.status}`);
        }
        return JSON.parse(text);
      } catch (error) {
        lastError = error;
        const wait = attempt * 8000;
        console.log(`  ${endpoint} — ${error.message}. ${wait / 1000}s kutib qayta urinaman…`);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }
  throw lastError ?? new Error("Overpass'ga ulanib bo'lmadi");
}

// ---- OSM relation -> GeoJSON ----
// Ma'muriy chegara relation ichida tartibsiz "way" bo'laklari bo'ladi.
// Ularni uchma-uch ulab, yopiq halqalarga yig'amiz.
function assembleRings(members) {
  const segments = members
    .filter((member) => member.type === "way" && Array.isArray(member.geometry))
    .filter((member) => member.role === "outer" || member.role === "inner" || !member.role)
    .map((member) => ({
      role: member.role === "inner" ? "inner" : "outer",
      points: member.geometry.map((point) => [Number(point.lon), Number(point.lat)]),
    }))
    .filter((segment) => segment.points.length >= 2);

  const rings = [];
  for (const role of ["outer", "inner"]) {
    const pool = segments.filter((segment) => segment.role === role).map((segment) => segment.points);
    while (pool.length > 0) {
      let ring = pool.shift().slice();
      let extended = true;
      while (extended && !isClosed(ring)) {
        extended = false;
        for (let i = 0; i < pool.length; i += 1) {
          const candidate = pool[i];
          const joined = tryJoin(ring, candidate);
          if (joined) {
            ring = joined;
            pool.splice(i, 1);
            extended = true;
            break;
          }
        }
      }
      if (isClosed(ring) && ring.length >= 4) rings.push({ role, ring });
    }
  }
  return rings;
}

const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
const isClosed = (ring) => ring.length >= 4 && same(ring[0], ring[ring.length - 1]);

function tryJoin(ring, candidate) {
  const head = ring[0];
  const tail = ring[ring.length - 1];
  if (same(tail, candidate[0])) return ring.concat(candidate.slice(1));
  if (same(tail, candidate[candidate.length - 1])) return ring.concat(candidate.slice().reverse().slice(1));
  if (same(head, candidate[candidate.length - 1])) return candidate.slice(0, -1).concat(ring);
  if (same(head, candidate[0])) return candidate.slice().reverse().slice(0, -1).concat(ring);
  return null;
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(area) / 2;
}

// Har bir tashqi halqa alohida poligon; ichki halqa (teshik) o'zini
// o'rab turgan eng kichik tashqi halqaga biriktiriladi.
function ringsToGeometry(rings) {
  const outers = rings.filter((item) => item.role === "outer").map((item) => item.ring);
  const inners = rings.filter((item) => item.role === "inner").map((item) => item.ring);
  if (outers.length === 0) return null;

  const polygons = outers
    .sort((a, b) => ringArea(b) - ringArea(a))
    .map((outer) => [outer]);

  for (const inner of inners) {
    const point = inner[0];
    const host = polygons.find(([outer]) => pointInRing(point, outer));
    (host ?? polygons[0]).push(inner);
  }

  return polygons.length === 1
    ? { type: "Polygon", coordinates: polygons[0] }
    : { type: "MultiPolygon", coordinates: polygons };
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---- Soddalashtirish (Douglas-Peucker) ----
// Rasmiy chegarada nuqta juda ko'p bo'ladi. Viloyat masshtabida bu detal
// ko'rinmaydi, lekin fayl hajmini va chizish vaqtini bir necha barobar
// oshiradi. 0.0002 daraja ~ 20 metr.
function perpendicularDistance(point, start, end) {
  const [x, y] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (x1 + clamped * dx), y - (y1 + clamped * dy));
}

function simplifyLine(points, tolerance) {
  if (points.length < 3 || tolerance <= 0) return points;
  let maxDistance = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (distance > maxDistance) { maxDistance = distance; index = i; }
  }
  if (maxDistance <= tolerance) return [points[0], points[points.length - 1]];
  return simplifyLine(points.slice(0, index + 1), tolerance)
    .slice(0, -1)
    .concat(simplifyLine(points.slice(index), tolerance));
}

function simplifyRing(ring, tolerance) {
  const simplified = simplifyLine(ring, tolerance);
  // Halqa yopiq va kamida 4 nuqtali bo'lib qolishi shart — aks holda
  // soddalashtirish geometriyani buzadi.
  if (simplified.length >= 4) return simplified;
  return ring;
}

function simplifyGeometry(geometry, tolerance) {
  if (tolerance <= 0) return geometry;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const next = polygons.map((rings) => rings.map((ring) => simplifyRing(ring, tolerance)));
  return geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: next[0] }
    : { type: "MultiPolygon", coordinates: next };
}

function countVertices(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.reduce((sum, rings) => sum + rings.reduce((s, ring) => s + ring.length, 0), 0);
}

// OSM nomlarida "Tumani" / "tumani" qo'shimchasi bor. Ro'yxatda bir xil
// ko'rinishi uchun uni olib tashlaymiz: "Denov Tumani" -> "Denov".
function cleanName(tags) {
  const raw = tags["name:uz"] ?? tags.name ?? "";
  return raw.replace(/\s+tumani$/i, "").trim();
}

async function loginForToken(api, login) {
  const [name, password] = login.split(":");
  const response = await fetch(`${api}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: name, password }),
  });
  if (!response.ok) throw new Error("Login muvaffaqiyatsiz");
  return (await response.json()).token;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.token && args.login) args.token = await loginForToken(args.api, args.login);
  if (!args.token && !args.dryRun) {
    console.error("Xato: --token yoki --login kerak. Masalan: --login admin:admin12345");
    process.exit(1);
  }

  console.log(`OpenStreetMap'dan "${args.level}" chegaralari so'ralmoqda…`);
  const data = await fetchOverpass(buildQuery(args.level));
  const elements = (data.elements ?? []).filter((element) => element.type === "relation");
  console.log(`Topildi: ${elements.length} ta hudud`);

  const regions = [];
  let skipped = 0;
  for (const element of elements) {
    const name = cleanName(element.tags ?? {});
    if (!name) { skipped += 1; continue; }

    const rings = assembleRings(element.members ?? []);
    const geometry = ringsToGeometry(rings);
    if (!geometry) {
      console.log(`  ⚠ ${name}: chegara halqasi yopilmadi, o'tkazib yuborildi`);
      skipped += 1;
      continue;
    }

    const before = countVertices(geometry);
    const simplified = simplifyGeometry(geometry, args.tolerance);
    const after = countVertices(simplified);

    regions.push({
      name,
      level: LEVEL_BY_ADMIN_LEVEL[element.tags.admin_level] ?? args.level,
      source: "osm",
      sourceId: `relation/${element.id}`,
      code: element.tags["ref:soato"] ?? element.tags.ref ?? "",
      geometry: simplified,
    });
    console.log(`  ${name}: ${before} → ${after} nuqta`);
  }

  console.log(`\nTayyor: ${regions.length} ta hudud, ${skipped} ta o'tkazib yuborildi`);

  if (args.out) {
    const { writeFile } = await import("node:fs/promises");
    const collection = {
      type: "FeatureCollection",
      features: regions.map((region) => ({
        type: "Feature",
        geometry: region.geometry,
        properties: { name: region.name, level: region.level, sourceId: region.sourceId },
      })),
    };
    await writeFile(args.out, `${JSON.stringify(collection)}\n`, "utf8");
    console.log(`GeoJSON yozildi: ${args.out}`);
  }

  if (args.dryRun) {
    console.log("--dry-run: serverga hech narsa yuborilmadi.");
    return;
  }

  const response = await fetch(`${args.api}/regions/import`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${args.token}` },
    body: JSON.stringify({ regions, source: "osm", status: "published" }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`Import xatosi (${response.status}): ${body.message ?? "noma'lum xato"}`);
    process.exit(1);
  }
  console.log(`Serverga yozildi: ${body.created} ta yangi, ${body.updated} ta yangilangan.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
