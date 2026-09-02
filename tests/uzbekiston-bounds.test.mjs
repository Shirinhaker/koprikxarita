import test from "node:test";
import assert from "node:assert/strict";
import {
  SURXONDARYO_BOUNDS,
  UZBEKISTAN_BOUNDS,
  boundsOverlap,
  isPositionInside,
  parseBbox,
} from "../src/domain/uzbekiston.mjs";
import { isInsideSurxondaryo as roadInside } from "../src/domain/roads.mjs";
import { isInsideSurxondaryo as buildingInside } from "../src/domain/buildings.mjs";
import { isInsideSurxondaryo as regionInside } from "../src/domain/regions.mjs";

// Sariosiyo — Surxondaryoning eng shimoliy tumani, 39.03 gacha cho'ziladi.
// Avvalgi tekshiruv shimolni 38.7 deb bilgani uchun bu yerdagi har bir
// obyekt noto'g'ri ogohlantirish olardi.
const SARIOSIYO_SHIMOL = [67.9, 39.0];
const TERMIZ = [67.28, 37.23];
const NUKUS = [59.6, 42.46];
const TOSHKENT = [69.24, 41.3];
const MOSKVA = [37.6, 55.75];

test("mamlakat chegarasi barcha viloyatlarni o‘z ichiga oladi", () => {
  for (const [nom, nuqta] of [["Termiz", TERMIZ], ["Sariosiyo", SARIOSIYO_SHIMOL], ["Nukus", NUKUS], ["Toshkent", TOSHKENT]]) {
    assert.equal(isPositionInside(nuqta), true, `${nom} mamlakat ichida bo‘lishi kerak`);
  }
  assert.equal(isPositionInside(MOSKVA), false);
});

test("Surxondaryo chegarasi Sariosiyoni qamrab oladi", () => {
  assert.ok(SURXONDARYO_BOUNDS.north >= 39.04, "Sariosiyo 39.0351 gacha yetadi");
  assert.equal(isPositionInside(SARIOSIYO_SHIMOL, SURXONDARYO_BOUNDS), true);
  assert.equal(isPositionInside(NUKUS, SURXONDARYO_BOUNDS), false);
});

test("Sariosiyodagi yo‘l va bino ogohlantirish bermaydi", () => {
  assert.equal(roadInside({ type: "LineString", coordinates: [[67.9, 38.95], SARIOSIYO_SHIMOL] }), true);
  assert.equal(buildingInside({
    type: "Polygon",
    coordinates: [[[67.9, 38.98], [67.91, 38.98], [67.91, 39.0], [67.9, 39.0], [67.9, 38.98]]],
  }), true);
});

test("boshqa viloyatdagi yo‘l ham qabul qilinadi", () => {
  assert.equal(roadInside({ type: "LineString", coordinates: [NUKUS, [59.7, 42.5]] }), true, "Qoraqalpog‘iston");
  assert.equal(roadInside({ type: "LineString", coordinates: [TOSHKENT, [69.3, 41.35]] }), true, "Toshkent");
});

test("mamlakatdan tashqaridagi obyekt aniqlanadi", () => {
  assert.equal(roadInside({ type: "LineString", coordinates: [TERMIZ, MOSKVA] }), false);
  assert.equal(regionInside({
    type: "Polygon",
    coordinates: [[[37.5, 55.7], [37.7, 55.7], [37.7, 55.8], [37.5, 55.8], [37.5, 55.7]]],
  }), false);
});

test("chegara qiymati uch domenda ham bitta manbadan olinadi", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const file of ["roads.mjs", "buildings.mjs", "regions.mjs"]) {
    const source = await readFile(new URL(`../src/domain/${file}`, import.meta.url), "utf8");
    assert.match(source, /uzbekiston\.mjs/, `${file} umumiy chegaradan foydalanishi kerak`);
    assert.doesNotMatch(source, /north:\s*38\.7/, `${file} da eski noto‘g‘ri chegara qolmasligi kerak`);
  }
});

// ---- bbox yordamchilari ----

test("bbox matni o‘qiladi va buzug‘i rad etiladi", () => {
  assert.deepEqual(parseBbox("66.9,37.1,68.1,38.4"), { west: 66.9, south: 37.1, east: 68.1, north: 38.4 });
  assert.equal(parseBbox("68.1,37.1,66.9,38.4"), null, "g‘arb sharqdan katta bo‘lolmaydi");
  assert.equal(parseBbox("66.9,37.1,68.1"), null, "to‘rtta son kerak");
  assert.equal(parseBbox("a,b,c,d"), null);
  assert.equal(parseBbox(""), null);
  assert.equal(parseBbox(undefined), null);
});

test("chegara qutilari kesishishi aniqlanadi", () => {
  const a = { west: 66, south: 37, east: 68, north: 39 };
  assert.equal(boundsOverlap(a, { west: 67, south: 38, east: 69, north: 40 }), true, "qisman ustma-ust");
  assert.equal(boundsOverlap(a, { west: 66.5, south: 37.5, east: 67, north: 38 }), true, "ichida");
  assert.equal(boundsOverlap(a, { west: 70, south: 37, east: 71, north: 39 }), false, "uzoqda");
  assert.equal(boundsOverlap(a, { west: 68, south: 39, east: 69, north: 40 }), true, "chekkasi tegib turibdi");
});
