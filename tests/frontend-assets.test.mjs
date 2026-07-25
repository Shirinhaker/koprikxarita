import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("asosiy sahifa qidiruv, xarita va tahrirlash boshqaruvlarini beradi", async () => {
  const html = await readFile(new URL("../apps/web/public/index.html", import.meta.url), "utf8");
  assert.match(html, /aria-label="Ko‘cha qidirish"/);
  assert.match(html, /data-testid="map-canvas"/);
  assert.match(html, /Ko‘cha chizish/);
  assert.match(html, /Admin kirish/);
});

test("frontend skripti saqlash xatosida draftni tozalamaslik oqimini ishlatadi", async () => {
  const script = await readFile(new URL("../apps/web/public/app.js", import.meta.url), "utf8");
  assert.match(script, /createEditorState/);
  assert.match(script, /reloadRoads/);
  assert.match(script, /expectedUpdatedAt/);
});

test("fon xarita haqiqiy OpenStreetMap raster plitkalaridan tuziladi", async () => {
  let mapStyleModule;
  try {
    mapStyleModule = await import(new URL("../apps/web/public/map-style.mjs", import.meta.url));
  } catch {
    mapStyleModule = undefined;
  }

  assert.equal(typeof mapStyleModule?.createOsmRasterStyle, "function");
  const style = mapStyleModule.createOsmRasterStyle();
  assert.equal(style.version, 8);
  assert.deepEqual(style.sources.osm.tiles, ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"]);
  assert.equal(style.sources.osm.type, "raster");
  assert.equal(style.sources.osm.tileSize, 256);
  assert.match(style.sources.osm.attribution, /OpenStreetMap contributors/);
  assert.equal(style.layers[0].source, "osm");
  assert.equal(style.layers[0].type, "raster");
});
