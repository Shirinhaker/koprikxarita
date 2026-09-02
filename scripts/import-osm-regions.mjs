#!/usr/bin/env node
//
// O'zbekiston viloyatlari va tumanlarining chegaralarini OpenStreetMap'dan
// yuklab, /api/regions/import ga yuboradi.
//
// Ishlatish:
//   npm run import-regions -- --login admin:PAROL --dry-run
//   npm run import-regions -- --login admin:PAROL
//
// Bayroqlar:
//   --api <manzil>       standart: http://localhost:4100/api
//   --login user:parol   token o'rniga (avval login qiladi)
//   --token <token>      tayyor token
//   --only <ro'yxat>     faqat shu viloyatlar (vergul bilan), masalan: Surxondaryo,Buxoro
//   --skip-districts     faqat viloyat chegaralarini yuklaydi
//   --tolerance-viloyat  standart 0.004 (~400 m) — mamlakat ko'rinishi uchun yetarli
//   --tolerance-tuman    standart 0.0008 (~80 m)
//   --dry-run            serverga yozmasdan, faqat nima kelishini ko'rsatadi
//   --out <fayl>         yuklangan GeoJSON'ni faylga ham yozadi
//
// Nega ikki daraja: 206 ta tumanning to'liq geometriyasi ~7 MB. Uni sahifa
// ochilishida yuklab bo'lmaydi. Shuning uchun viloyatlar qattiq
// soddalashtiriladi (ular doim ko'rinadi), tumanlar esa xarita
// ko'rinayotgan hudud bo'yicha so'raladi.
//
// Mahalla bu skriptda yo'q: OSM'da Surxondaryo bo'yicha atigi 3 ta bor,
// shuning uchun mahalla qo'lda chiziladi.

// Overpass oynalari. Tartib muhim: birinchisi ishlasa qolganiga
// umuman murojaat qilinmaydi.
//
// maps.mail.ru birinchi turibdi — O'zbekistondan overpass-api.de va
// overpass.kumi.systems ulanish darajasida ochilmasligi kuzatilgan
// (HTTP xatosi emas, umuman ulanmaydi). Ular ro'yxatda zaxira
// sifatida qoldi: boshqa tarmoqdan ishlatilsa asqotadi.
const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// Ulanmaydigan oyna bir marta aniqlanadi va shu ishga tushirish
// davomida boshqa urinilmaydi. Aks holda har so'rovda o'lik manzilga
// ikki daqiqa sarflanardi — 15 ta so'rovda yarim soat.
const deadEndpoints = new Set();

// O'zbekiston davlat chegarasi — xaritada qo'shni davlatlarni yopadigan
// niqob shundan quriladi.
const COUNTRY_RELATION_ID = 196240;

// O'zbekistonning yuqori ma'muriy birliklari. Qoraqalpog'iston
// admin_level=3 (avtonom respublika), qolganlari 4 — shuning uchun
// bitta so'rov bilan topib bo'lmaydi va ro'yxat qo'lda qotirilgan.
//
// colorIndex — region-palette.mjs dagi rang raqami. Qo'lda tanlanmagan:
// viloyatlarning haqiqiy chegaradoshligi geometriyadan hisoblanib
// (18 ta chegaradosh juftlik topildi), ranglar shu graf bo'yicha
// optimallashtirilgan. Natija: chegaradosh ikki viloyat rangi orasidagi
// eng kichik farq ΔE 23.7 (talab >= 15). Oddiy g'arbdan-sharqqa
// tartibda bu ko'rsatkich 10.4 edi va Jizzax bilan Navoiy deyarli
// bir xil ko'rinardi.
//
// Viloyat qo'shilsa yoki chegara o'zgarsa, bu raqamlarni qayta
// hisoblash kerak — docs/HUDUDLAR.md da usuli yozilgan.
const PROVINCES = [
  { id: 196241, name: "Qoraqalpogʻiston Respublikasi", colorIndex: 10 },
  { id: 196242, name: "Xorazm", colorIndex: 11 },
  { id: 1670973, name: "Buxoro", colorIndex: 8 },
  { id: 196246, name: "Navoiy", colorIndex: 7 },
  { id: 1670974, name: "Qashqadaryo", colorIndex: 9 },
  { id: 196248, name: "Surxondaryo", colorIndex: 12 },
  { id: 196249, name: "Samarqand", colorIndex: 6 },
  { id: 196254, name: "Jizzax", colorIndex: 4 },
  { id: 196253, name: "Sirdaryo", colorIndex: 1 },
  { id: 196251, name: "Toshkent", colorIndex: 3 },
  { id: 2216724, name: "Toshkent shahri", colorIndex: 5 },
  { id: 178017, name: "Namangan", colorIndex: 0 },
  { id: 178016, name: "Andijon", colorIndex: 13 },
  { id: 178018, name: "Fargʻona", colorIndex: 2 },
];

// OSM admin_level -> loyihadagi daraja.
const LEVEL_BY_ADMIN_LEVEL = { 3: "viloyat", 4: "viloyat", 6: "tuman", 7: "tuman", 9: "mahalla", 10: "mahalla" };

function parseArgs(argv) {
  const args = {
    api: "http://localhost:4100/api",
    toleranceViloyat: 0.004,
    toleranceTuman: 0.0008,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--dry-run") { args.dryRun = true; continue; }
    if (key === "--skip-districts") { args.skipDistricts = true; continue; }
    const value = argv[i + 1];
    if (key === "--api") args.api = value;
    else if (key === "--token") args.token = value;
    else if (key === "--login") args.login = value;
    else if (key === "--only") args.only = value.split(",").map((name) => name.trim().toLowerCase());
    else if (key === "--tolerance-viloyat") args.toleranceViloyat = Number(value);
    else if (key === "--tolerance-tuman") args.toleranceTuman = Number(value);
    else if (key === "--out") args.out = value;
    else continue;
    i += 1;
  }
  return args;
}

function countryQuery() {
  return `[out:json][timeout:180];
rel(${COUNTRY_RELATION_ID});
out geom;`;
}

function provinceQuery(ids) {
  return `[out:json][timeout:180];
(${ids.map((id) => `rel(${id});`).join("")});
out geom;`;
}

function districtQuery(provinceId) {
  return `[out:json][timeout:180];
rel(${provinceId});map_to_area->.p;
rel(area.p)["boundary"="administrative"]["admin_level"~"^(6|7)$"];
out geom;`;
}

// Overpass ochiq va bepul xizmat — so'rov cheklanishi odatiy hol.
// Shuning uchun bir nechta oyna sinaladi va kutish vaqti oshirib boriladi.
async function fetchOverpass(query) {
  let lastError;
  const live = OVERPASS_ENDPOINTS.filter((endpoint) => !deadEndpoints.has(endpoint));
  if (live.length === 0) {
    throw new Error("Overpass oynalarining hech biri ulanmadi. Tarmoqni tekshiring.");
  }

  for (const endpoint of live) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(endpoint, { method: "POST", body: query });
        const text = await response.text();
        if (!response.ok || text.trimStart().startsWith("<")) {
          const limited = /rate_limited|too many requests/i.test(text);
          const error = new Error(limited ? "Overpass so'rovni cheklab qo'ydi" : `Overpass HTTP ${response.status}`);
          error.serverReplied = true;
          throw error;
        }
        return JSON.parse(text);
      } catch (error) {
        lastError = error;

        // Ulanishning o'zi bo'lmasa — bu vaqtinchalik bandlik emas,
        // manzil shu tarmoqdan ochilmaydi. Qayta urinish behuda.
        if (!error.serverReplied) {
          deadEndpoints.add(endpoint);
          console.log(`  ${endpoint} — ulanmadi, bu oyna o'tkazib yuborildi`);
          break;
        }

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
// OSM nomlarida "Tumani", "Viloyati", "Respublikasi" qo'shimchasi bor va
// harf katta-kichikligi bir xil emas ("Denov Tumani", "Uzun tumani").
// Ro'yxatda va xaritada bir ko'rinishda bo'lishi uchun qo'shimcha
// olib tashlanadi: "Denov Tumani" -> "Denov".
// Toshkent shahri istisno — "shahri" uning nomining bir qismi va u
// Toshkent viloyatidan shu bilan ajralib turadi.
function cleanName(tags, level) {
  const raw = (tags["name:uz"] ?? tags.name ?? "").trim();
  if (level === "tuman") return raw.replace(/\s+(tumani|tuman|rayoni)$/i, "").trim();
  if (level === "viloyat") {
    if (/shahri|shahar/i.test(raw)) return raw;
    return raw.replace(/\s+viloyati$/i, "").trim();
  }
  return raw;
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

// OSM relation -> loyihadagi hudud obyekti.
function toRegion(element, { level, tolerance, parentId = null, colorIndex = null, name: override = null }) {
  // Viloyat nomi ro'yxatdan olinadi, OSM'dan emas: OSM'da Toshkent
  // shahri ham, Toshkent viloyati ham "Toshkent" deb nomlangan va
  // ular ro'yxatda farqlanmay qolardi.
  const name = override ?? cleanName(element.tags ?? {}, level);
  if (!name) return null;
  const rings = assembleRings(element.members ?? []);
  const geometry = ringsToGeometry(rings);
  if (!geometry) return null;

  const before = countVertices(geometry);
  const simplified = simplifyGeometry(geometry, tolerance);
  return {
    region: {
      name,
      level,
      parentId,
      colorIndex,
      source: "osm",
      sourceId: `relation/${element.id}`,
      code: element.tags["ref:soato"] ?? element.tags.ref ?? "",
      geometry: simplified,
    },
    before,
    after: countVertices(simplified),
  };
}

async function post(api, token, regions, label) {
  const response = await fetch(`${api}/regions/import`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ regions, source: "osm", status: "published" }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${label} import xatosi (${response.status}): ${body.message ?? "noma'lum xato"}`);
  }
  return body;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.token && args.login) args.token = await loginForToken(args.api, args.login);
  if (!args.token && !args.dryRun) {
    console.error("Xato: --token yoki --login kerak. Masalan: --login admin:PAROL");
    process.exit(1);
  }

  const wanted = args.only
    ? PROVINCES.filter((p) => args.only.some((name) => p.name.toLowerCase().includes(name)))
    : PROVINCES;
  if (wanted.length === 0) {
    console.error("--only bo'yicha hech qanday viloyat topilmadi");
    process.exit(1);
  }

  // ---- 0-bosqich: davlat chegarasi (niqob uchun) ----
  // Faqat to'liq import bo'lganda — --only bilan bir viloyat
  // yuklanayotganda mamlakat konturini qayta yozish shart emas.
  if (!args.only && !args.dryRun) {
    console.log("0/2 — davlat chegarasi…");
    try {
      const data = await fetchOverpass(countryQuery());
      const element = (data.elements ?? []).find((e) => e.type === "relation");
      const built = element && toRegion(element, {
        level: "davlat",
        tolerance: args.toleranceViloyat,
        name: "O‘zbekiston",
      });
      if (built) {
        await post(args.api, args.token, [built.region], "Davlat");
        console.log(`  O‘zbekiston  ${built.before} → ${built.after} nuqta`);
      } else {
        console.log("  ⚠ davlat chegarasi qurilmadi, niqobsiz davom etamiz");
      }
    } catch (error) {
      console.log(`  ⚠ davlat chegarasi olinmadi: ${error.message}`);
    }
  }

  // ---- 1-bosqich: viloyatlar ----
  console.log(`1/2 — ${wanted.length} ta viloyat chegarasi so'ralmoqda…`);
  const provinceData = await fetchOverpass(provinceQuery(wanted.map((p) => p.id)));
  const provinceElements = (provinceData.elements ?? []).filter((e) => e.type === "relation");

  const viloyatlar = [];
  for (const province of wanted) {
    const element = provinceElements.find((e) => e.id === province.id);
    if (!element) {
      console.log(`  ⚠ ${province.name}: OSM'dan kelmadi`);
      continue;
    }
    // Rang raqami — ro'yxatdagi o'rin. Ro'yxat g'arbdan sharqqa
    // tartiblangan, palitra esa qo'shni o'rinlarga eng farqli ranglarni
    // beradi. Demak xaritada yonma-yon turgan viloyatlar o'xshamaydi.
    const built = toRegion(element, {
      level: "viloyat",
      tolerance: args.toleranceViloyat,
      colorIndex: province.colorIndex,
      name: province.name,
    });
    if (!built) {
      console.log(`  ⚠ ${province.name}: chegara halqasi yopilmadi`);
      continue;
    }
    viloyatlar.push({ ...built, province, colorIndex: province.colorIndex });
    console.log(`  ${built.region.name.padEnd(30)} ${String(built.before).padStart(5)} → ${String(built.after).padStart(4)} nuqta  · rang ${province.colorIndex + 1}`);
  }

  console.log(`\nViloyatlar tayyor: ${viloyatlar.length} ta`);

  let provinceIdByOsm = new Map();
  if (!args.dryRun) {
    const result = await post(args.api, args.token, viloyatlar.map((v) => v.region), "Viloyatlar");
    console.log(`Serverga yozildi: ${result.created} ta yangi, ${result.updated} ta yangilangan.`);
    for (const region of result.regions ?? []) provinceIdByOsm.set(region.sourceId, region.id);
  }

  if (args.skipDistricts) {
    console.log("--skip-districts: tumanlar o'tkazib yuborildi.");
    return;
  }

  // ---- 2-bosqich: tumanlar, viloyat bo'yicha navbat bilan ----
  // Bir so'rovda butun mamlakat tumanlarini so'rash Overpass'ni
  // yiqitadi (504). Shuning uchun viloyatma-viloyat, orasida pauza bilan.
  console.log(`\n2/2 — ${viloyatlar.length} ta viloyatning tumanlari…`);
  const allDistricts = [];
  let totalBefore = 0;
  let totalAfter = 0;

  for (const viloyat of viloyatlar) {
    const parentId = provinceIdByOsm.get(viloyat.region.sourceId) ?? null;
    if (!args.dryRun && !parentId) {
      console.log(`  ⚠ ${viloyat.region.name}: viloyat identifikatori topilmadi, tumanlari o'tkazildi`);
      continue;
    }

    let data;
    try {
      data = await fetchOverpass(districtQuery(viloyat.province.id));
    } catch (error) {
      console.log(`  ✖ ${viloyat.region.name}: ${error.message}`);
      continue;
    }

    const districts = [];
    for (const element of (data.elements ?? []).filter((e) => e.type === "relation")) {
      const built = toRegion(element, {
        level: "tuman",
        tolerance: args.toleranceTuman,
        parentId: parentId ?? "dry-run",
        colorIndex: viloyat.colorIndex,
      });
      if (!built) continue;
      districts.push(built.region);
      totalBefore += built.before;
      totalAfter += built.after;
    }

    console.log(`  ${viloyat.region.name.padEnd(30)} ${String(districts.length).padStart(3)} ta tuman`);
    allDistricts.push(...districts);

    if (!args.dryRun && districts.length > 0) {
      const result = await post(args.api, args.token, districts, viloyat.region.name);
      if (result.created + result.updated !== districts.length) {
        console.log(`    ⚠ yozildi: ${result.created} yangi, ${result.updated} yangilangan`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log(`\nTumanlar: ${allDistricts.length} ta · nuqtalar ${totalBefore} → ${totalAfter}`);

  if (args.out) {
    const { writeFile } = await import("node:fs/promises");
    const all = [...viloyatlar.map((v) => v.region), ...allDistricts];
    await writeFile(args.out, `${JSON.stringify({
      type: "FeatureCollection",
      features: all.map((region) => ({
        type: "Feature",
        geometry: region.geometry,
        properties: { name: region.name, level: region.level, colorIndex: region.colorIndex, sourceId: region.sourceId },
      })),
    })}\n`, "utf8");
    console.log(`GeoJSON yozildi: ${args.out}`);
  }

  if (args.dryRun) console.log("\n--dry-run: serverga hech narsa yuborilmadi.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
