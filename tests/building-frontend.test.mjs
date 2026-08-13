import test from "node:test";
import assert from "node:assert/strict";
import {
  createEsriSource,
  createEsriLayer,
  attachEsriProjector,
  setEsriOpacity,
  setEsriVisible,
  ESRI_LAYER_ID,
  ESRI_SOURCE_ID,
  DEFAULT_ESRI_OPACITY,
} from "../apps/web/public/esri-layer.mjs";
import {
  createSavedBuildingLayers,
  createDraftBuildingLayers,
  BUILDING_MACHINE_FILL,
  BUILDING_PUBLISHED_FILL,
  DRAFT_BUILDING_LINE,
} from "../apps/web/public/building-style.mjs";

function layerById(layers, id) {
  return layers.find((layer) => layer.id === id);
}

// Soxta xarita — MapLibre map obyektining minimal taqlidi.
function fakeMap() {
  const sources = new Map();
  const layers = new Map();
  const paint = new Map();
  const layout = new Map();
  return {
    getSource: (id) => sources.get(id),
    getLayer: (id) => layers.get(id),
    addSource: (id, def) => sources.set(id, def),
    addLayer: (def, beforeId) => { layers.set(def.id, def); layers.get(def.id).beforeId = beforeId; },
    setPaintProperty: (id, prop, value) => paint.set(`${id}:${prop}`, value),
    setLayoutProperty: (id, prop, value) => layout.set(`${id}:${prop}`, value),
    _paint: paint,
    _layout: layout,
  };
}

// ---------- Esri proyektor ----------

test("Esri manba to‘g‘ri tile shablonini talab qiladi", () => {
  assert.throws(() => createEsriSource({ tileUrl: "https://x/no-template" }), TypeError);
  const source = createEsriSource();
  assert.equal(source.type, "raster");
  assert.ok(source.attribution.includes("Esri"));
});

test("Esri qatlam standart holatda xira (proyektor)", () => {
  const layer = createEsriLayer();
  assert.equal(layer.paint["raster-opacity"], DEFAULT_ESRI_OPACITY);
  assert.equal(layer.type, "raster");
});

test("opacity 0–1 oralig‘iga cheklanadi", () => {
  assert.equal(createEsriLayer({ opacity: 5 }).paint["raster-opacity"], 1);
  assert.equal(createEsriLayer({ opacity: -3 }).paint["raster-opacity"], 0);
});

test("attachEsriProjector manba va qatlamni beforeId bilan qo‘shadi", () => {
  const map = fakeMap();
  attachEsriProjector(map, { opacity: 0.4, beforeId: "buildings-fill" });
  assert.ok(map.getSource(ESRI_SOURCE_ID));
  assert.equal(map.getLayer(ESRI_LAYER_ID).beforeId, "buildings-fill");
});

test("setEsriOpacity va setEsriVisible xaritaga ta’sir qiladi", () => {
  const map = fakeMap();
  attachEsriProjector(map);
  setEsriOpacity(map, 0.8);
  setEsriVisible(map, false);
  assert.equal(map._paint.get(`${ESRI_LAYER_ID}:raster-opacity`), 0.8);
  assert.equal(map._layout.get(`${ESRI_LAYER_ID}:visibility`), "none");
});

// ---------- Bino uslublari ----------

test("saqlangan binolar to‘ldirilgan poligon va kontur sifatida chiziladi", () => {
  const layers = createSavedBuildingLayers();
  const fill = layerById(layers, "buildings-fill");
  const outline = layerById(layers, "buildings-outline");
  assert.equal(fill.type, "fill");
  assert.equal(outline.type, "line");
  // Rang data-driven (case ifodasi), manba/holatga bog‘liq.
  assert.equal(Array.isArray(fill.paint["fill-color"]), true);
  assert.ok(fill.paint["fill-color"].includes(BUILDING_PUBLISHED_FILL));
  assert.ok(fill.paint["fill-color"].includes(BUILDING_MACHINE_FILL));
});

test("draft bino poligoni yorqin konturda, nuqtalari bilan ko‘rinadi", () => {
  const layers = createDraftBuildingLayers();
  const fill = layerById(layers, "draft-building-fill");
  const outline = layerById(layers, "draft-building-outline");
  const points = layerById(layers, "draft-building-points");
  assert.equal(fill.filter[2], "polygon");
  assert.equal(outline.paint["line-color"], DRAFT_BUILDING_LINE);
  assert.equal(points.filter[2], "point");
  assert.equal(points.paint["circle-stroke-color"], DRAFT_BUILDING_LINE);
});
