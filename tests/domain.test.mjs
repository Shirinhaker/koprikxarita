import test from "node:test";
import assert from "node:assert/strict";
import {
  RoadValidationError,
  canPublishRoad,
  toFeatureCollection,
  validateRoadInput,
} from "../src/domain/roads.mjs";

const validRoad = {
  name: "Istiqlol ko‘chasi",
  roadType: "residential",
  surface: "asphalt",
  direction: "two_way",
  status: "draft",
  districtName: "Qumqo‘rg‘on",
  neighborhoodName: "Yangi shahar",
  geometry: {
    type: "LineString",
    coordinates: [
      [67.2801, 37.9201],
      [67.2815, 37.9214],
    ],
  },
};

test("kamida ikki nuqtasi bo‘lmagan yo‘l rad etiladi", () => {
  assert.throws(
    () => validateRoadInput({ ...validRoad, geometry: { type: "LineString", coordinates: [[67.28, 37.92]] } }),
    (error) => error instanceof RoadValidationError && error.code === "ROAD_GEOMETRY_TOO_SHORT",
  );
});

test("nomsiz ko‘cha draft sifatida saqlanishi mumkin", () => {
  const parsed = validateRoadInput({ ...validRoad, name: "" });
  assert.equal(parsed.name, "");
  assert.equal(parsed.status, "draft");
});

test("nomsiz ko‘chani nashr qilib bo‘lmaydi", () => {
  assert.deepEqual(canPublishRoad({ ...validRoad, name: "   " }), {
    ok: false,
    message: "Nashr qilish uchun ko‘cha nomi kerak",
  });
});

test("yo‘llar GeoJSON FeatureCollectionga aylantiriladi", () => {
  const collection = toFeatureCollection([{ ...validRoad, id: "road-1", createdAt: "x", updatedAt: "x" }]);
  assert.equal(collection.type, "FeatureCollection");
  assert.equal(collection.features[0].geometry.type, "LineString");
  assert.equal(collection.features[0].properties.name, "Istiqlol ko‘chasi");
});
