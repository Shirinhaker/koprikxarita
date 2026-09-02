import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// BUILD 0007 dan boshlab Microsoft import boshqaruvi alohida modulga ko'chirildi;
// u config.js orqali dinamik yuklanadi, buildings-app.mjs esa unga tegmaydi.
const source = await readFile(new URL("../apps/web/public/microsoft-import-panel.mjs", import.meta.url), "utf8");
const config = await readFile(new URL("../apps/web/public/config.js", import.meta.url), "utf8");

test("binolar panelida Microsoft import boshqaruvi yaratiladi", () => {
  assert.match(source, /Microsoft binolarini yuklash/);
  assert.match(source, /microsoft-import-controls/);
});

test("Microsoft import paneli sahifaga ulanadi", () => {
  assert.match(config, /microsoft-import-panel\.mjs/);
});

test("Microsoft import API start va status endpointlari ishlatiladi", () => {
  assert.match(source, /\/buildings\/import-microsoft["`]/);
  assert.match(source, /\/buildings\/import-microsoft\/status/);
});

test("import tugagach draft binolarni ko‘rsatish uchun Barchasi filtri tanlanadi", () => {
  assert.match(source, /#buildingStatusFilter/);
  assert.match(source, /\.value\s*=\s*["']all["']/);
});

test("import tugagach sahifa qayta yuklanmaydi — filtr o‘zgarishi qatlamni yangilaydi", () => {
  assert.match(source, /dispatchEvent\(new Event\("change"/);
  assert.doesNotMatch(source, /window\.location\.reload\(\)/);
});
