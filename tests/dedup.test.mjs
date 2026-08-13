import test from "node:test";
import assert from "node:assert/strict";
import {
  iou,
  boundingBox,
  centroid,
  pointInPolygon,
  findDuplicateGroups,
  chooseSurvivor,
  planDeduplication,
} from "../src/domain/dedup.mjs";

// Kvadrat poligon yordamchisi.
function square(lng, lat, size = 0.0003) {
  return {
    type: "Polygon",
    coordinates: [[
      [lng, lat],
      [lng + size, lat],
      [lng + size, lat + size],
      [lng, lat + size],
      [lng, lat],
    ]],
  };
}

test("bir xil poligon IoU = 1", () => {
  const g = square(67.28, 37.22);
  assert.ok(iou(g, g) > 0.98);
});

test("uzoq poligonlar IoU = 0", () => {
  assert.equal(iou(square(67.28, 37.22), square(69.24, 41.31)), 0);
});

test("yarim ustma-ust poligonlar IoU ~ 0.33", () => {
  // ikki teng kvadrat yarmigacha siljigan -> kesishma 0.5, union 1.5 -> ~0.33
  const a = square(67.28, 37.22, 0.0004);
  const b = square(67.28 + 0.0002, 37.22, 0.0004);
  const value = iou(a, b, 128);
  assert.ok(value > 0.25 && value < 0.42, `IoU=${value}`);
});

test("bounding box va centroid to‘g‘ri", () => {
  const g = square(67.28, 37.22, 0.0004);
  const box = boundingBox(g);
  assert.ok(Math.abs(box.west - 67.28) < 1e-9);
  assert.ok(Math.abs(box.east - 67.2804) < 1e-9);
  const c = centroid(g);
  assert.ok(Math.abs(c[0] - 67.2802) < 1e-6);
});

test("pointInPolygon ichki va tashqi nuqtani ajratadi", () => {
  const g = square(67.28, 37.22, 0.0004);
  assert.equal(pointInPolygon([67.2802, 37.2202], g), true);
  assert.equal(pointInPolygon([67.30, 37.24], g), false);
});

test("ustma-ust binolar bitta guruhga birlashadi", () => {
  const buildings = [
    { id: "a", source: "microsoft", geometry: square(67.28, 37.22, 0.0004) },
    { id: "b", source: "osm", geometry: square(67.28004, 37.22004, 0.0004) }, // deyarli aynan
    { id: "c", source: "microsoft", geometry: square(67.40, 37.30, 0.0004) }, // uzoq, alohida
  ];
  const groups = findDuplicateGroups(buildings, { threshold: 0.5 });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 2);
  assert.deepEqual(groups[0].map((b) => b.id).sort(), ["a", "b"]);
});

test("survivor tanlash: OSM Microsoft'dan ustun", () => {
  const group = [
    { id: "ms", source: "microsoft", status: "draft", verified: false, areaSqm: 100 },
    { id: "osm", source: "osm", status: "draft", verified: false, areaSqm: 100 },
  ];
  const { survivor, duplicates } = chooseSurvivor(group);
  assert.equal(survivor.id, "osm");
  assert.equal(duplicates[0].id, "ms");
});

test("survivor tanlash: nashr qilingan / tekshirilgan ustun", () => {
  const group = [
    { id: "raw", source: "manual", status: "draft", verified: false },
    { id: "pub", source: "microsoft", status: "published", verified: true },
  ];
  assert.equal(chooseSurvivor(group).survivor.id, "pub");
});

test("planDeduplication umumiy dublikat sonini beradi", () => {
  const buildings = [
    { id: "a", source: "microsoft", status: "draft", geometry: square(67.28, 37.22, 0.0004) },
    { id: "b", source: "osm", status: "draft", geometry: square(67.28004, 37.22004, 0.0004) },
    { id: "c", source: "microsoft", status: "draft", geometry: square(67.28008, 37.22008, 0.0004) },
    { id: "d", source: "microsoft", status: "draft", geometry: square(67.50, 37.40, 0.0004) },
  ];
  const plan = planDeduplication(buildings, { threshold: 0.4 });
  assert.equal(plan.groupCount, 1);
  assert.equal(plan.totalDuplicates, 2); // a,b,c bitta guruh -> 1 qoladi, 2 arxiv
  assert.equal(plan.groups[0].survivor.source, "osm"); // OSM ustun
});
