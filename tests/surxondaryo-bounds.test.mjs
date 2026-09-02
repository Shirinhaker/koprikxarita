import test from "node:test";
import assert from "node:assert/strict";
import { SURXONDARYO_BOUNDS, isPositionInside } from "../src/domain/surxondaryo.mjs";
import { isInsideSurxondaryo as roadInside } from "../src/domain/roads.mjs";
import { isInsideSurxondaryo as buildingInside } from "../src/domain/buildings.mjs";
import { isInsideSurxondaryo as regionInside } from "../src/domain/regions.mjs";

// Sariosiyo — viloyatning eng shimoliy tumani, 39.03 kenglikkacha
// cho'ziladi. Avvalgi tekshiruv shimolni 38.7 deb bilgani uchun bu
// yerdagi har bir obyekt noto'g'ri ogohlantirish olardi.
const SARIOSIYO_SHIMOL = [67.9, 39.0];
const TERMIZ = [67.28, 37.23];
const TOSHKENT = [69.24, 41.3];

test("viloyat chegarasi haqiqiy shimoliy nuqtani o‘z ichiga oladi", () => {
  assert.ok(SURXONDARYO_BOUNDS.north >= 39.04, "Sariosiyo 39.0351 gacha yetadi");
  assert.equal(isPositionInside(SARIOSIYO_SHIMOL), true);
  assert.equal(isPositionInside(TERMIZ), true);
  assert.equal(isPositionInside(TOSHKENT), false);
});

test("Sariosiyodagi yo‘l endi ogohlantirish bermaydi", () => {
  assert.equal(roadInside({ type: "LineString", coordinates: [[67.9, 38.95], SARIOSIYO_SHIMOL] }), true);
});

test("Sariosiyodagi bino endi ogohlantirish bermaydi", () => {
  assert.equal(buildingInside({
    type: "Polygon",
    coordinates: [[[67.9, 38.98], [67.91, 38.98], [67.91, 39.0], [67.9, 39.0], [67.9, 38.98]]],
  }), true);
});

test("viloyatdan tashqaridagi obyekt hamon aniqlanadi", () => {
  assert.equal(roadInside({ type: "LineString", coordinates: [TERMIZ, TOSHKENT] }), false);
  assert.equal(regionInside({
    type: "Polygon",
    coordinates: [[[69.2, 41.2], [69.3, 41.2], [69.3, 41.3], [69.2, 41.3], [69.2, 41.2]]],
  }), false);
});

test("chegara qiymati uch domenda ham bitta manbadan olinadi", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const file of ["roads.mjs", "buildings.mjs", "regions.mjs"]) {
    const source = await readFile(new URL(`../src/domain/${file}`, import.meta.url), "utf8");
    assert.match(source, /surxondaryo\.mjs/, `${file} umumiy chegaradan foydalanishi kerak`);
    assert.doesNotMatch(source, /north:\s*38\.7/, `${file} da eski noto‘g‘ri chegara qolmasligi kerak`);
  }
});
