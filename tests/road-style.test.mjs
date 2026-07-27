import test from "node:test";
import assert from "node:assert/strict";
import {
  createSavedRoadLayers,
  createDraftRoadLayers,
  ROAD_CASING_COLOR,
  ROAD_FILL_COLOR,
} from "../apps/web/public/road-style.mjs";

function layerById(layers, id) {
  return layers.find((layer) => layer.id === id);
}

test("saqlangan ichki ko‘chalar OSM yo‘liga o‘xshash oq va kulrang qoplamada chiziladi", () => {
  const layers = createSavedRoadLayers();
  const casing = layerById(layers, "roads-casing");
  const fill = layerById(layers, "roads-fill");

  assert.equal(casing.paint["line-color"], ROAD_CASING_COLOR);
  assert.equal(fill.paint["line-color"], ROAD_FILL_COLOR);
  assert.equal(casing.layout["line-cap"], "round");
  assert.equal(casing.layout["line-join"], "round");
  assert.equal(fill.layout["line-cap"], "round");
  assert.equal(fill.layout["line-join"], "round");
  assert.deepEqual(casing.paint["line-width"], [
    "interpolate", ["exponential", 1.55], ["zoom"],
    10, 0.7, 12, 1.4, 14, 2.8, 16, 5, 18, 8.2, 20, 11.5,
  ]);
  assert.deepEqual(fill.paint["line-width"], [
    "interpolate", ["exponential", 1.55], ["zoom"],
    10, 0.35, 12, 0.8, 14, 1.8, 16, 3.5, 18, 6.2, 20, 8.8,
  ]);
  assert.deepEqual(fill.paint["line-opacity"], [
    "interpolate", ["linear"], ["zoom"], 10, 0, 11, 0.72, 12, 1,
  ]);
});

test("chizishdagi draft yo‘l rangli yoki uzuq emas, saqlangan yo‘lning o‘zi kabi ko‘rinadi", () => {
  const layers = createDraftRoadLayers();
  const casing = layerById(layers, "draft-casing");
  const fill = layerById(layers, "draft-fill");
  const points = layerById(layers, "draft-points");

  assert.equal(casing.paint["line-color"], ROAD_CASING_COLOR);
  assert.equal(fill.paint["line-color"], ROAD_FILL_COLOR);
  assert.equal("line-dasharray" in fill.paint, false);
  assert.equal(points.paint["circle-color"], ROAD_FILL_COLOR);
  assert.equal(points.paint["circle-stroke-color"], ROAD_CASING_COLOR);
});
