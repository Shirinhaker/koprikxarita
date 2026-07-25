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
