import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../apps/web/public/buildings-app.mjs", import.meta.url), "utf8");

test("binolar panelida Microsoft import boshqaruvi yaratiladi", () => {
  assert.match(source, /Microsoft binolarini yuklash/);
  assert.match(source, /microsoft-import-controls/);
});

test("Microsoft import API start va status endpointlari ishlatiladi", () => {
  assert.match(source, /\/buildings\/import-microsoft["`]/);
  assert.match(source, /\/buildings\/import-microsoft\/status/);
});

test("import tugagach draft binolarni ko‘rsatish uchun Barchasi filtri tanlanadi", () => {
  assert.match(source, /statusFilter\.value\s*=\s*["']all["']/);
});
