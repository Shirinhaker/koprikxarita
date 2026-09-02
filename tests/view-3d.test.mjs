import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createBuildingExtrusionLayer } from "../apps/web/public/view-3d.mjs";

// MapLibre ifodasini oddiy obyekt ustida hisoblaydigan mitti tarjimon.
// Faqat shu qatlamda ishlatilgan operatorlar qo'llanadi — maqsad
// balandlik mantiqini haqiqatda tekshirish, MapLibre'ni qayta yozish emas.
function evaluate(expression, properties) {
  if (!Array.isArray(expression)) return expression;
  const [op, ...args] = expression;
  switch (op) {
    case "get": return properties[evaluate(args[0], properties)];
    case "coalesce": {
      for (const arg of args) {
        const value = evaluate(arg, properties);
        if (value !== undefined && value !== null) return value;
      }
      return null;
    }
    case ">": return evaluate(args[0], properties) > evaluate(args[1], properties);
    case "==": return evaluate(args[0], properties) === evaluate(args[1], properties);
    case "*": return evaluate(args[0], properties) * evaluate(args[1], properties);
    case "case": {
      for (let i = 0; i + 1 < args.length; i += 2) {
        if (evaluate(args[i], properties)) return evaluate(args[i + 1], properties);
      }
      return evaluate(args[args.length - 1], properties);
    }
    case "match": {
      const input = evaluate(args[0], properties);
      for (let i = 1; i + 1 < args.length; i += 2) {
        if (args[i] === input) return evaluate(args[i + 1], properties);
      }
      return evaluate(args[args.length - 1], properties);
    }
    case "in": {
      const needle = evaluate(args[0], properties);
      const list = args[1]?.[0] === "literal" ? args[1][1] : evaluate(args[1], properties);
      return Array.isArray(list) && list.includes(needle);
    }
    default: throw new Error(`Qo‘llanmagan operator: ${op}`);
  }
}

const layer = createBuildingExtrusionLayer();
const height = (properties) => evaluate(layer.paint["fill-extrusion-height"], properties);

test("ekstruziya qatlami bino manbasiga ulanadi va boshda yashirin", () => {
  assert.equal(layer.id, "buildings-3d");
  assert.equal(layer.type, "fill-extrusion");
  assert.equal(layer.source, "buildings-source");
  assert.equal(layer.layout.visibility, "none", "3D boshlanishida o‘chiq bo‘lishi kerak");
});

test("balandlik qavatlar sonidan hisoblanadi", () => {
  assert.equal(height({ levels: 1, buildingType: "residential" }), 3);
  assert.equal(height({ levels: 5, buildingType: "residential" }), 15);
  assert.equal(height({ levels: 9, buildingType: "commercial" }), 27);
});

test("qavati yo‘q bino turiga qarab taxminiy balandlik oladi", () => {
  assert.equal(height({ levels: null, buildingType: "residential" }), 6);
  assert.equal(height({ levels: 0, buildingType: "health" }), 12);
  assert.equal(height({ buildingType: "industrial" }), 9);
});

test("noma’lum tur ham balandliksiz qolmaydi", () => {
  const value = height({ buildingType: "kutilmagan-tur" });
  assert.ok(value > 0, `noma’lum tur uchun ham balandlik bo‘lishi kerak, hozir: ${value}`);
});

test("3D faqat yaqinlashganda ko‘rinadi", () => {
  assert.ok(layer.minzoom >= 14, "uzoqdan hajm faqat shovqin qiladi");
});

test("3D tugmasi sahifada bor va holati e’lon qilinadi", async () => {
  const html = await readFile(new URL("../apps/web/public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="view3dButton"/);
  assert.match(html, /aria-pressed="false"/);
});

test("xarita qiyalikka ruxsat beradi", async () => {
  const appJs = await readFile(new URL("../apps/web/public/app.js", import.meta.url), "utf8");
  assert.match(appJs, /maxPitch: 60/);
  assert.doesNotMatch(appJs, /maxPitch: 0/, "qiyalik bloklanmasligi kerak");
  assert.match(appJs, /initView3d\(map,/);
});

test("3D yoqilganda tekis bino qatlami o‘chadi", async () => {
  const source = await readFile(new URL("../apps/web/public/view-3d.mjs", import.meta.url), "utf8");
  // Ikkalasi bir vaqtda ko'rinsa, binolar ustma-ust tushib xunuk chiqadi.
  assert.match(source, /buildings-fill.*visibility/s);
});
