import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  RegionValidationError,
  findRegionAtPoint,
  isInsideSurxondaryo,
  isPointInRegion,
  regionBounds,
  regionLabelPoint,
  toFeatureCollection,
  toLabelFeatureCollection,
  validateRegionGeometry,
  validateRegionInput,
} from "../src/domain/regions.mjs";
import { JsonRegionRepository, RegionConflictError } from "../src/storage/json-region-repository.mjs";

const actor = { id: "admin-1", fullName: "Test admin" };

// Termiz atrofidagi oddiy kvadrat.
const square = (west, south, size = 0.1) => ({
  type: "Polygon",
  coordinates: [[
    [west, south],
    [west + size, south],
    [west + size, south + size],
    [west, south + size],
    [west, south],
  ]],
});

const viloyatInput = (name = "Surxondaryo", geometry = square(66.9, 37.3, 1.5)) => ({
  name,
  level: "viloyat",
  source: "osm",
  sourceId: `relation/v-${name}`,
  colorIndex: 5,
  geometry,
});

// Tuman endi viloyatsiz bo‘lolmaydi — ierarxiya viloyat -> tuman -> mahalla.
const tumanInput = (name = "Denov", geometry = square(67.2, 37.9), parentId = "viloyat-1") => ({
  name,
  level: "tuman",
  parentId,
  source: "osm",
  sourceId: `relation/${name}`,
  geometry,
});

// ---- Geometriya ----

test("yopilmagan halqa avtomatik yopiladi", () => {
  const geometry = validateRegionGeometry({
    type: "Polygon",
    coordinates: [[[67.2, 37.9], [67.3, 37.9], [67.3, 38.0], [67.2, 38.0]]],
  });
  const ring = geometry.coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1]);
});

test("MultiPolygon qabul qilinadi va shakli saqlanadi", () => {
  const geometry = validateRegionGeometry({
    type: "MultiPolygon",
    coordinates: [square(67.2, 37.9).coordinates, square(67.5, 38.1).coordinates],
  });
  assert.equal(geometry.type, "MultiPolygon");
  assert.equal(geometry.coordinates.length, 2);
});

test("bitta poligonli MultiPolygon oddiy Polygonga keltiriladi", () => {
  const geometry = validateRegionGeometry({
    type: "MultiPolygon",
    coordinates: [square(67.2, 37.9).coordinates],
  });
  assert.equal(geometry.type, "Polygon");
});

test("LineString geometriya rad etiladi", () => {
  assert.throws(
    () => validateRegionGeometry({ type: "LineString", coordinates: [[67.2, 37.9], [67.3, 38.0]] }),
    (error) => error instanceof RegionValidationError && error.code === "REGION_GEOMETRY_INVALID",
  );
});

test("buzuq halqa (uch xil nuqtasiz) rad etiladi", () => {
  assert.throws(
    () => validateRegionGeometry({
      type: "Polygon",
      coordinates: [[[67.2, 37.9], [67.2, 37.9], [67.2, 37.9], [67.2, 37.9]]],
    }),
    (error) => error instanceof RegionValidationError && error.code === "REGION_RING_DEGENERATE",
  );
});

// ---- Maydonlar ----

test("nomsiz hudud rad etiladi", () => {
  assert.throws(
    () => validateRegionInput({ ...tumanInput(), name: "   " }),
    (error) => error.code === "REGION_FIELD_REQUIRED",
  );
});

test("mahalla uchun tuman ko‘rsatilishi shart", () => {
  assert.throws(
    () => validateRegionInput({ name: "Mustaqillik", level: "mahalla", geometry: square(67.2, 37.9) }),
    (error) => error.code === "REGION_PARENT_REQUIRED",
  );
});

test("tuman uchun viloyat ko‘rsatilishi shart", () => {
  assert.throws(
    () => validateRegionInput({ ...tumanInput(), parentId: null }),
    (error) => error.code === "REGION_PARENT_REQUIRED",
  );
});

test("viloyatga yuqori hudud biriktirib bo‘lmaydi", () => {
  assert.throws(
    () => validateRegionInput({ ...viloyatInput(), parentId: "boshqa" }),
    (error) => error.code === "REGION_PARENT_INVALID",
  );
});

test("viloyat yuqori hududsiz qabul qilinadi", () => {
  const parsed = validateRegionInput(viloyatInput());
  assert.equal(parsed.level, "viloyat");
  assert.equal(parsed.parentId, null);
  assert.equal(parsed.colorIndex, 5);
});

test("noto‘g‘ri rang raqami rad etiladi", () => {
  assert.throws(
    () => validateRegionInput({ ...viloyatInput(), colorIndex: -1 }),
    (error) => error.code === "REGION_COLOR_INVALID",
  );
});

test("parentId berilgan mahalla qabul qilinadi", () => {
  const parsed = validateRegionInput({
    name: "Mustaqillik",
    level: "mahalla",
    parentId: "tuman-1",
    geometry: square(67.2, 37.9, 0.01),
  });
  assert.equal(parsed.level, "mahalla");
  assert.equal(parsed.parentId, "tuman-1");
});

test("noma’lum daraja rad etiladi", () => {
  assert.throws(
    () => validateRegionInput({ ...tumanInput(), level: "shahar" }),
    (error) => error.code === "REGION_FIELD_INVALID",
  );
});

// ---- Fazoviy amallar ----

test("nuqta hudud ichida yoki tashqarisidaligi aniqlanadi", () => {
  const geometry = square(67.2, 37.9);
  assert.equal(isPointInRegion([67.25, 37.95], geometry), true);
  assert.equal(isPointInRegion([67.5, 37.95], geometry), false);
});

test("teshik ichidagi nuqta hudud ichida hisoblanmaydi", () => {
  const geometry = validateRegionGeometry({
    type: "Polygon",
    coordinates: [
      [[67.0, 37.0], [68.0, 37.0], [68.0, 38.0], [67.0, 38.0], [67.0, 37.0]],
      [[67.4, 37.4], [67.6, 37.4], [67.6, 37.6], [67.4, 37.6], [67.4, 37.4]],
    ],
  });
  assert.equal(isPointInRegion([67.1, 37.1], geometry), true);
  assert.equal(isPointInRegion([67.5, 37.5], geometry), false);
});

test("mahalla tumandan ustun — aniqroq hudud qaytariladi", () => {
  const tuman = { id: "t1", level: "tuman", geometry: square(67.0, 37.0, 1) };
  const mahalla = { id: "m1", level: "mahalla", geometry: square(67.2, 37.2, 0.1) };
  assert.equal(findRegionAtPoint([67.25, 37.25], [tuman, mahalla]).id, "m1");
  assert.equal(findRegionAtPoint([67.8, 37.8], [tuman, mahalla]).id, "t1");
  assert.equal(findRegionAtPoint([60, 30], [tuman, mahalla]), null);
});

test("chegara qutisi to‘g‘ri hisoblanadi", () => {
  assert.deepEqual(regionBounds(square(67.2, 37.9)), {
    west: 67.2, south: 37.9, east: 67.3, north: 38.0,
  });
});

test("O‘zbekistondan tashqaridagi hudud aniqlanadi", () => {
  assert.equal(isInsideSurxondaryo(square(67.2, 37.9)), true, "Surxondaryo");
  assert.equal(isInsideSurxondaryo(square(60.0, 41.0)), true, "Xorazm/Qoraqalpog‘iston tomoni");
  assert.equal(isInsideSurxondaryo(square(50.0, 50.0)), false, "mamlakatdan tashqarida");
});

test("nom nuqtasi hudud ichida bo‘ladi", () => {
  const geometry = square(67.2, 37.9);
  assert.equal(isPointInRegion(regionLabelPoint(geometry), geometry), true);
});

test("MultiPolygon nomi eng keng bo‘lakka qo‘yiladi", () => {
  const geometry = validateRegionGeometry({
    type: "MultiPolygon",
    coordinates: [square(67.0, 37.0, 0.02).coordinates, square(68.0, 38.0, 0.4).coordinates],
  });
  const [lng] = regionLabelPoint(geometry);
  assert.ok(lng > 67.9, `nom nuqtasi katta bo‘lakda bo‘lishi kerak, hozir: ${lng}`);
});

// ---- GeoJSON ----

test("hududlar FeatureCollectionga aylantiriladi", () => {
  const collection = toFeatureCollection([
    { id: "r1", name: "Denov", level: "tuman", parentId: null, code: "", source: "osm", status: "published", geometry: square(67.2, 37.9) },
  ]);
  assert.equal(collection.type, "FeatureCollection");
  assert.equal(collection.features[0].properties.name, "Denov");
  assert.equal(collection.features[0].properties.level, "tuman");
});

test("nom qatlami har hudud uchun bitta nuqta beradi", () => {
  const regions = [
    { id: "r1", name: "Denov", level: "tuman", geometry: square(67.2, 37.9) },
    { id: "r2", name: "Boysun", level: "tuman", geometry: square(67.4, 38.1) },
  ];
  const labels = toLabelFeatureCollection(regions);
  assert.equal(labels.features.length, 2);
  assert.equal(labels.features[0].geometry.type, "Point");
  assert.equal(labels.features[0].properties.name, "Denov");
});

// ---- Saqlash ----

async function withRepository(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "koprik-regions-"));
  const repository = new JsonRegionRepository({
    regionsFile: path.join(dir, "regions.json"),
    logFile: path.join(dir, "region-change-log.json"),
  });
  try {
    await run(repository);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("yaratilgan hudud keyingi o‘qishda saqlanib qoladi", async () => {
  await withRepository(async (repository) => {
    const created = await repository.create(tumanInput(), actor);
    assert.equal(created.status, "draft");
    const found = await repository.getById(created.id);
    assert.equal(found.name, "Denov");
  });
});

test("nashr qilingan hudud published ro‘yxatida ko‘rinadi, arxivlangani yo‘q", async () => {
  await withRepository(async (repository) => {
    const created = await repository.create(tumanInput(), actor);
    await repository.publish(created.id, actor);
    assert.equal((await repository.list("published")).length, 1);

    await repository.archive(created.id, actor);
    assert.equal((await repository.list("published")).length, 0);
    assert.equal((await repository.list("archived")).length, 1);

    await repository.restore(created.id, actor);
    assert.equal((await repository.list("draft")).length, 1);
  });
});

test("import bir xil sourceId'ni takrorlamaydi, yangilaydi", async () => {
  await withRepository(async (repository) => {
    const first = await repository.importMany([tumanInput("Denov")], actor, { source: "osm", status: "published" });
    assert.equal(first.created, 1);
    assert.equal(first.updated, 0);

    // Aynan shu tuman, lekin chegarasi yangilangan.
    const second = await repository.importMany(
      [{ ...tumanInput("Denov"), geometry: square(67.25, 37.95) }],
      actor,
      { source: "osm", status: "published" },
    );
    assert.equal(second.created, 0);
    assert.equal(second.updated, 1);

    const all = await repository.list("published");
    assert.equal(all.length, 1, "dublikat yaratilmasligi kerak");
    assert.equal(all[0].geometry.coordinates[0][0][0], 67.25);
  });
});

test("import qilingan hudud darhol nashr qilingan holatda keladi", async () => {
  await withRepository(async (repository) => {
    await repository.importMany([tumanInput()], actor, { source: "osm", status: "published" });
    assert.equal((await repository.list("published")).length, 1);
  });
});

test("eski updatedAt bilan tahrirlash ziddiyat qaytaradi", async () => {
  await withRepository(async (repository) => {
    const created = await repository.create(tumanInput(), actor);
    await repository.update(created.id, { ...tumanInput("Denov shahri"), expectedUpdatedAt: created.updatedAt }, actor);
    await assert.rejects(
      () => repository.update(created.id, { ...tumanInput("Yana"), expectedUpdatedAt: created.updatedAt }, actor),
      (error) => error instanceof RegionConflictError,
    );
  });
});

test("daraja bo‘yicha filtr ishlaydi", async () => {
  await withRepository(async (repository) => {
    const tuman = await repository.create(tumanInput(), actor);
    await repository.create({
      name: "Mustaqillik",
      level: "mahalla",
      parentId: tuman.id,
      source: "manual",
      geometry: square(67.21, 37.91, 0.01),
    }, actor);

    assert.equal((await repository.list("draft", { level: "tuman" })).length, 1);
    assert.equal((await repository.list("draft", { level: "mahalla" })).length, 1);
    assert.equal((await repository.list("draft")).length, 2);
  });
});

test("jurnalda geometriya to‘liq emas, o‘lchov sifatida saqlanadi", async () => {
  await withRepository(async (repository) => {
    const created = await repository.create(tumanInput(), actor);
    const { readFile } = await import("node:fs/promises");
    const logs = JSON.parse(await readFile(repository.logFile, "utf8"));
    const entry = logs.find((item) => item.regionId === created.id);
    assert.equal(entry.newData.geometry.type, "Polygon");
    assert.equal(typeof entry.newData.geometry.vertices, "number");
    assert.equal(entry.newData.geometry.coordinates, undefined, "jurnalda koordinatalar bo‘lmasligi kerak");
  });
});

test("qidiruv hudud nomi bo‘yicha ishlaydi", async () => {
  await withRepository(async (repository) => {
    await repository.importMany(
      [tumanInput("Denov"), tumanInput("Boysun", square(67.5, 38.1))],
      actor,
      { source: "osm", status: "published" },
    );
    const found = await repository.search("boy", "published");
    assert.equal(found.length, 1);
    assert.equal(found[0].name, "Boysun");
  });
});

// ---- Frontend ulanishi ----
// Hudud qatlami app.js orqali oddiy modul sifatida ulanadi. config.js ichida
// global funksiyalarni almashtirish naqshi takrorlanmasligi kerak.

test("hudud qatlami app.js dan chaqiriladi, config.js yamog‘i orqali emas", async () => {
  const { readFile } = await import("node:fs/promises");
  const appJs = await readFile(new URL("../apps/web/public/app.js", import.meta.url), "utf8");
  const configJs = await readFile(new URL("../apps/web/public/config.js", import.meta.url), "utf8");

  assert.match(appJs, /import \{ initRegions \} from "\.\/regions-app\.mjs"/);
  assert.match(appJs, /initRegions\(map,/);
  assert.doesNotMatch(configJs, /regions/i, "config.js hudud qatlamiga aralashmasligi kerak");
});

test("hudud qatlami yo‘llar ostiga qo‘yiladi", async () => {
  const { readFile } = await import("node:fs/promises");
  const appJs = await readFile(new URL("../apps/web/public/app.js", import.meta.url), "utf8");
  assert.match(appJs, /beforeId: "roads-casing"/);
});

test("chegara boshqaruvi sahifada bor", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../apps/web/public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="regionsToggle"/);
  assert.match(html, /id="regionsCount"/);
});

test("hudud uslubi: rang viloyatdan, og‘irlik darajadan", async () => {
  const { createRegionLayers } = await import("../apps/web/public/region-style.mjs");
  const layers = createRegionLayers();
  assert.deepEqual(layers.map((layer) => layer.id), ["regions-fill", "regions-line"]);

  const line = layers.find((layer) => layer.id === "regions-line");
  const fill = layers.find((layer) => layer.id === "regions-fill");

  // Rang viloyatga tegishli — tuman uni meros qiladi, shuning uchun
  // rang darajaga emas, colorIndex ga qarab tanlanadi.
  for (const paint of [line.paint["line-color"], fill.paint["fill-color"]]) {
    const text = JSON.stringify(paint);
    assert.ok(text.includes('["get","colorIndex"]'), "rang colorIndex dan olinishi kerak");
    assert.ok(!text.includes('["get","level"]'), "rang darajaga bog‘liq bo‘lmasligi kerak");
  }

  // Og‘irlik esa aksincha — darajaga qarab.
  for (const paint of [line.paint["line-width"], line.paint["line-dasharray"], fill.paint["fill-opacity"]]) {
    assert.ok(JSON.stringify(paint).includes('["get","level"]'), "og‘irlik darajaga bog‘liq bo‘lishi kerak");
  }
});

test("palitra 14 ta viloyat uchun 14 ta rang beradi", async () => {
  const { PROVINCE_COLORS, provinceColor, NO_PROVINCE_COLOR } = await import("../apps/web/public/region-palette.mjs");
  assert.equal(PROVINCE_COLORS.length, 14);
  assert.equal(new Set(PROVINCE_COLORS).size, 14, "ranglar takrorlanmasligi kerak");
  assert.equal(provinceColor(0), PROVINCE_COLORS[0]);
  assert.equal(provinceColor(13), PROVINCE_COLORS[13]);
  assert.equal(provinceColor(null), NO_PROVINCE_COLOR, "viloyati yo‘q hudud betaraf rangda");
  for (const color of PROVINCE_COLORS) assert.match(color, /^#[0-9a-f]{6}$/);
});

test("niqob butun dunyodan mamlakatni o‘yib oladi", async () => {
  const { createMaskFeature } = await import("../apps/web/public/region-style.mjs");
  const country = square(60, 40, 5);
  const mask = createMaskFeature(country);
  assert.equal(mask.geometry.type, "Polygon");
  // Birinchi halqa — dunyo, keyingilari — teshik (mamlakat).
  assert.equal(mask.geometry.coordinates.length, 2);
  assert.deepEqual(mask.geometry.coordinates[0][0], [-180, -85]);
  assert.deepEqual(mask.geometry.coordinates[1], country.coordinates[0]);
});

test("MultiPolygon mamlakat har bo‘lagi uchun teshik ochadi", async () => {
  const { createMaskFeature } = await import("../apps/web/public/region-style.mjs");
  const mask = createMaskFeature({
    type: "MultiPolygon",
    coordinates: [square(60, 40, 2).coordinates, square(64, 40, 2).coordinates],
  });
  assert.equal(mask.geometry.coordinates.length, 3, "dunyo + ikki teshik");
});

test("mamlakat geometriyasi bo‘lmasa niqob dunyoni yopmaydi", async () => {
  const { createMaskFeature } = await import("../apps/web/public/region-style.mjs");
  const mask = createMaskFeature(null);
  assert.equal(mask.geometry.coordinates.length, 1, "teshiksiz niqob — hammasi yopiladi");
});

test("tuman qatlami faqat yaqinlashganda va bbox bilan so‘raladi", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../apps/web/public/regions-app.mjs", import.meta.url), "utf8");
  // Butun mamlakat tumanlari ~1.7 MB — ular bbox'siz so‘ralmasligi shart.
  assert.match(source, /level=tuman&bbox=/, "tuman bbox bilan so‘ralishi kerak");
  assert.match(source, /TUMAN_ZOOM/, "zoom chegarasi bo‘lishi kerak");
  assert.match(source, /level=viloyat/, "viloyat alohida yuklanadi");
  assert.match(source, /level=davlat/, "niqob uchun davlat konturi");
  // Eski hiyla takrorlanmasin.
  assert.doesNotMatch(source, /__viewport__/, "yashirin qidiruv matni ishlatilmasin");
});

test("xarita O‘zbekistonga markazlangan va chegaradan chiqmaydi", async () => {
  const { readFile } = await import("node:fs/promises");
  const config = await readFile(new URL("../apps/web/public/config.js", import.meta.url), "utf8");
  const appJs = await readFile(new URL("../apps/web/public/app.js", import.meta.url), "utf8");
  assert.match(config, /maxBounds:/, "chegara sozlamada bo‘lishi kerak");
  assert.match(appJs, /maxBounds: config\.maxBounds/, "chegara xaritaga uzatilishi kerak");
  // Markaz endi Surxondaryo emas, mamlakat o‘rtasi.
  assert.doesNotMatch(config, /center: \[67\.27, 37\.94\]/);
});

test("har viloyatga bitta va takrorlanmas rang biriktirilgan", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../scripts/import-osm-regions.mjs", import.meta.url), "utf8");
  const { PROVINCE_COLORS } = await import("../apps/web/public/region-palette.mjs");

  const indexes = [...source.matchAll(/colorIndex:\s*(\d+)\s*}/g)].map((m) => Number(m[1]));
  assert.equal(indexes.length, 14, "14 ta viloyat bo‘lishi kerak");
  assert.equal(new Set(indexes).size, 14, "rang raqamlari takrorlanmasligi kerak");
  for (const index of indexes) {
    assert.ok(index >= 0 && index < PROVINCE_COLORS.length, `rang raqami ${index} palitradan tashqarida`);
  }
});

test("Qoraqalpog‘iston admin_level=3 sifatida qo‘llanadi", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../scripts/import-osm-regions.mjs", import.meta.url), "utf8");
  // U avtonom respublika — 4-darajali so‘rovga tushmaydi, shuning uchun
  // ro‘yxatda alohida turishi va daraja jadvalida 3 bo‘lishi kerak.
  assert.match(source, /id: 196241/);
  assert.match(source, /3: "viloyat"/);
});
