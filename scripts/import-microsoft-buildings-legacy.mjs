#!/usr/bin/env node
// Microsoft Global ML Building Footprints -> Ko‘prik Xarita import skripti.
//
// NIMA QILADI:
//   1. Microsoft manifestini (dataset-links.csv) yuklaydi.
//   2. O‘zbekiston qatorlarini ajratadi, quadkey bo‘yicha Surxondaryo bbox bilan
//      kesishadiganlarini tanlaydi.
//   3. Har bir tile'ni (.csv.gz, gzip'langan line-delimited GeoJSON) yuklab ochadi.
//   4. Faqat Surxondaryo bbox ichidagi binolarni oladi, sizning import formatiga
//      aylantiradi (source="microsoft") va /api/buildings/import ga bo‘lib yuboradi.
//
// LITSENZIYA: Microsoft Building Footprints ODbL ostida — tijoratda ham
//   attribution bilan ruxsat etilgan. Import qilingan binolar "draft" bo‘ladi;
//   ular tekshirilib (verify) nashr qilinadi.
//
// ISHLATISH:
//   1) Serverni ishga tushiring:  npm start
//   2) Boshqa terminalda:
//      node scripts/import-microsoft-buildings.mjs --token <ADMIN_TOKEN>
//   ADMIN_TOKEN ni /api/auth/login orqali olasiz (pastda --login yordamchisi bor).
//
//   Ixtiyoriy bayroqlar:
//     --api http://localhost:4100/api   (standart)
//     --bbox 66.9,37.1,68.1,38.4        (Surxondaryo, lng/lat: west,south,east,north)
//     --batch 500                       (bir so‘rovdagi bino soni)
//     --max 0                           (0 = cheksiz; sinov uchun masalan 200)
//     --dry-run                         (yubormasdan faqat sanaydi)
//     --login admin:admin12345          (token o‘rniga: avval login qiladi)

import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

const MANIFEST_URL = "https://minedbuildings.blob.core.windows.net/global-buildings/dataset-links.csv";
const COUNTRY = "Uzbekistan";

// ---- Bayroqlarni o‘qish ----
function parseArgs(argv) {
  const args = { api: "http://localhost:4100/api", bbox: "66.9,37.1,68.1,38.4", batch: 500, max: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--dry-run") { args.dryRun = true; continue; }
    const value = argv[i + 1];
    if (key === "--token") args.token = value;
    else if (key === "--api") args.api = value;
    else if (key === "--bbox") args.bbox = value;
    else if (key === "--batch") args.batch = Number(value);
    else if (key === "--max") args.max = Number(value);
    else if (key === "--login") args.login = value;
    else continue;
    i += 1;
  }
  const [west, south, east, north] = args.bbox.split(",").map(Number);
  args.bounds = { west, south, east, north };
  return args;
}

// ---- Quadkey -> bbox (Bing tayl tizimi) ----
function quadkeyToTileXY(quadkey) {
  let x = 0; let y = 0;
  const z = quadkey.length;
  for (let i = z; i > 0; i -= 1) {
    const mask = 1 << (i - 1);
    const digit = quadkey[z - i];
    if (digit === "1") x |= mask;
    else if (digit === "2") y |= mask;
    else if (digit === "3") { x |= mask; y |= mask; }
  }
  return { x, y, z };
}

function tileXYToLngLat(x, y, z) {
  const n = 2 ** z;
  const lng = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return { lng, lat: (latRad * 180) / Math.PI };
}

function quadkeyBounds(quadkey) {
  const { x, y, z } = quadkeyToTileXY(quadkey);
  const nw = tileXYToLngLat(x, y, z);
  const se = tileXYToLngLat(x + 1, y + 1, z);
  return { west: nw.lng, north: nw.lat, east: se.lng, south: se.lat };
}

function boxesIntersect(a, b) {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

function pointInBounds([lng, lat], b) {
  return lng >= b.west && lng <= b.east && lat >= b.south && lat <= b.north;
}

// Poligon bbox ichidami — markaz nuqtasi bo‘yicha (tez va yetarli).
function polygonInBounds(geometry, b) {
  const ring = geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) return false;
  let x = 0; let y = 0;
  for (let i = 0; i < ring.length - 1; i += 1) { x += ring[i][0]; y += ring[i][1]; }
  const n = ring.length - 1;
  return pointInBounds([x / n, y / n], b);
}

// ---- CSV manifestini o‘qish ----
function parseCsvLine(line) {
  // dataset-links.csv oddiy: Location,QuadKey,Url,Size (URL da vergul yo‘q)
  const parts = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "," && !inQuotes) { parts.push(current); current = ""; }
    else current += ch;
  }
  parts.push(current);
  return parts;
}

async function fetchManifest() {
  process.stdout.write("Manifest yuklanmoqda… ");
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) throw new Error(`Manifest yuklanmadi: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split("\n").filter(Boolean);
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const iLoc = header.indexOf("Location");
  const iQk = header.indexOf("QuadKey");
  const iUrl = header.indexOf("Url");
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    if (cols[iLoc] === COUNTRY) rows.push({ quadkey: cols[iQk].trim(), url: cols[iUrl].trim() });
  }
  console.log(`${rows.length} ta ${COUNTRY} tayl topildi.`);
  return rows;
}

// ---- Bitta tile'ni yuklab, filtrlab, binolarni chiqarish ----
async function* readTileBuildings(url, bounds) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tayl yuklanmadi: HTTP ${res.status} (${url})`);
  const gunzip = createGunzip();
  Readable.fromWeb(res.body).pipe(gunzip);
  const rl = createInterface({ input: gunzip, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let feature;
    try { feature = JSON.parse(line); } catch { continue; }
    const geometry = feature.geometry;
    if (!geometry || geometry.type !== "Polygon") continue;
    if (!polygonInBounds(geometry, bounds)) continue;
    const levels = feature.properties?.height && feature.properties.height > 0
      ? Math.max(1, Math.round(feature.properties.height / 3))
      : null;
    yield { geometry, levels };
  }
}

// ---- API ga bo‘lib yuborish ----
async function postBatch(api, token, items) {
  const res = await fetch(`${api}/buildings/import`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ source: "microsoft", buildings: items }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Import xatosi: HTTP ${res.status} ${body.message ?? ""}`);
  }
  return (await res.json()).count ?? items.length;
}

async function loginForToken(api, login) {
  const [name, password] = login.split(":");
  const res = await fetch(`${api}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: name, password }),
  });
  if (!res.ok) throw new Error("Login muvaffaqiyatsiz");
  return (await res.json()).token;
}

// ---- Asosiy ----
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.token && args.login) args.token = await loginForToken(args.api, args.login);
  if (!args.token && !args.dryRun) {
    console.error("Xato: --token yoki --login kerak. Masalan: --login admin:admin12345");
    process.exit(1);
  }

  console.log(`Surxondaryo bbox: [${args.bounds.west}, ${args.bounds.south}, ${args.bounds.east}, ${args.bounds.north}]`);
  const manifest = await fetchManifest();

  // Faqat bbox bilan kesishadigan tayllar.
  const relevant = manifest.filter((row) => {
    try { return boxesIntersect(quadkeyBounds(row.quadkey), args.bounds); }
    catch { return false; }
  });
  console.log(`Surxondaryo bilan kesishadigan tayl: ${relevant.length} ta.`);

  let buffer = [];
  let sent = 0;
  let scanned = 0;

  for (const [index, row] of relevant.entries()) {
    process.stdout.write(`\r[${index + 1}/${relevant.length}] tayl ${row.quadkey} o‘qilmoqda… (topildi: ${sent + buffer.length})   `);
    try {
      for await (const building of readTileBuildings(row.url, args.bounds)) {
        scanned += 1;
        buffer.push(building);
        if (args.max && sent + buffer.length >= args.max) break;
        if (buffer.length >= args.batch) {
          if (!args.dryRun) sent += await postBatch(args.api, args.token, buffer);
          else sent += buffer.length;
          buffer = [];
        }
      }
    } catch (error) {
      console.log(`\n  Ogohlantirish: ${row.quadkey} o‘tkazib yuborildi — ${error.message}`);
    }
    if (args.max && sent + buffer.length >= args.max) break;
  }

  if (buffer.length) {
    if (!args.dryRun) sent += await postBatch(args.api, args.token, buffer);
    else sent += buffer.length;
  }

  console.log(`\n\nTayyor. ${sent} ta bino ${args.dryRun ? "topildi (dry-run, yuborilmadi)" : "import qilindi (draft holatida)"}.`);
  if (!args.dryRun) console.log("Endi ilovada ularni tekshirib (verify) nashr qiling.");
}

main().catch((error) => { console.error("\nXato:", error.message); process.exit(1); });
