import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import {
  validateBuildingInput,
  BuildingValidationError,
  canPublishBuilding,
  polygonAreaSqm,
  isInsideSurxondaryo,
  toFeatureCollection,
} from "../src/domain/buildings.mjs";
import { createKoprikServer } from "../apps/api/src/server.mjs";
import { JsonBuildingRepository } from "../src/storage/json-building-repository.mjs";

// Termiz atrofidagi kichik to‘rtburchak bino (Surxondaryo ichida).
function squareAround(lng, lat, d = 0.0002) {
  return {
    type: "Polygon",
    coordinates: [[
      [lng, lat],
      [lng + d, lat],
      [lng + d, lat + d],
      [lng, lat + d],
      [lng, lat],
    ]],
  };
}

// ---------- Domen testlari ----------

test("to‘g‘ri Polygon qabul qilinadi va maydon hisoblanadi", () => {
  const parsed = validateBuildingInput({
    buildingType: "residential",
    geometry: squareAround(67.28, 37.22),
  });
  assert.equal(parsed.buildingType, "residential");
  assert.equal(parsed.geometry.type, "Polygon");
  assert.ok(parsed.areaSqm > 0);
});

test("yopilmagan halqa avtomatik yopiladi", () => {
  const parsed = validateBuildingInput({
    buildingType: "other",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [67.28, 37.22],
        [67.2802, 37.22],
        [67.2802, 37.2202],
        [67.28, 37.2202],
      ]],
    },
  });
  const ring = parsed.geometry.coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1]);
});

test("LineString geometriya rad etiladi", () => {
  assert.throws(
    () => validateBuildingInput({ buildingType: "other", geometry: { type: "LineString", coordinates: [[67, 37], [67.1, 37.1]] } }),
    BuildingValidationError,
  );
});

test("kam nuqtali halqa rad etiladi", () => {
  assert.throws(
    () => validateBuildingInput({ buildingType: "other", geometry: { type: "Polygon", coordinates: [[[67, 37], [67.1, 37], [67, 37]]] } }),
    BuildingValidationError,
  );
});

test("noto‘g‘ri bino turi rad etiladi", () => {
  assert.throws(
    () => validateBuildingInput({ buildingType: "castle", geometry: squareAround(67.28, 37.22) }),
    BuildingValidationError,
  );
});

test("qavatlar soni chegaradan tashqarida rad etiladi", () => {
  assert.throws(
    () => validateBuildingInput({ buildingType: "residential", levels: 500, geometry: squareAround(67.28, 37.22) }),
    BuildingValidationError,
  );
});

test("mashina manbasidagi tekshirilmagan bino nashr qilinmaydi", () => {
  const check = canPublishBuilding({ source: "microsoft", verified: false });
  assert.equal(check.ok, false);
});

test("tekshirilgan mashina binosi va qo‘lda chizilgan bino nashrga tayyor", () => {
  assert.equal(canPublishBuilding({ source: "microsoft", verified: true }).ok, true);
  assert.equal(canPublishBuilding({ source: "manual", verified: false }).ok, true);
});

test("maydon hisoblash taxminan to‘g‘ri (~500 m2)", () => {
  // ~0.0002 daraja ≈ 22 m; 22x22 ≈ 480 m2 atrofida
  const area = polygonAreaSqm(squareAround(67.28, 37.22));
  assert.ok(area > 300 && area < 700, `area=${area}`);
});

test("Surxondaryo chegarasi tekshiruvi ishlaydi", () => {
  assert.equal(isInsideSurxondaryo(squareAround(67.28, 37.22)), true);
  assert.equal(isInsideSurxondaryo(squareAround(69.24, 41.31)), false); // Toshkent
});

test("FeatureCollection manba va tekshiruv maydonlarini saqlaydi", () => {
  const fc = toFeatureCollection([{
    id: "b1", geometry: squareAround(67.28, 37.22), name: "Uy",
    buildingType: "residential", material: "brick", levels: 2,
    status: "published", districtName: "Termiz", neighborhoodName: "Mustaqillik",
    source: "microsoft", sourceConfidence: 0.9, verified: true, areaSqm: 480,
    createdAt: "x", updatedAt: "y",
  }]);
  assert.equal(fc.features[0].properties.source, "microsoft");
  assert.equal(fc.features[0].properties.verified, true);
});

// ---------- Repository / API testlari ----------

async function withApi(callback) {
  const directory = await mkdtemp(path.join(tmpdir(), "koprik-bld-"));
  const buildingRepository = new JsonBuildingRepository({
    buildingsFile: path.join(directory, "buildings.json"),
    logFile: path.join(directory, "building-logs.json"),
  });
  const server = createKoprikServer({
    repository: { list: async () => [], search: async () => [] }, // yo‘llar uchun stub
    buildingRepository,
    jwtSecret: "test-secret",
    publicDir: path.resolve("apps/web/public"),
    users: [
      { id: "admin-1", fullName: "Administrator", login: "admin", password: "admin123", role: "admin" },
      { id: "viewer-1", fullName: "Tomoshabin", login: "viewer", password: "viewer123", role: "viewer" },
    ],
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await callback({ baseUrl, buildingRepository });
  } finally {
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
  }
}

async function login(baseUrl, loginName, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: loginName, password }),
  });
  return (await response.json()).token;
}

test("API: admin bino yaratadi, tekshiradi va nashr qiladi", async () => {
  await withApi(async ({ baseUrl }) => {
    const token = await login(baseUrl, "admin", "admin123");
    const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const createRes = await fetch(`${baseUrl}/api/buildings`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ buildingType: "residential", source: "microsoft", geometry: squareAround(67.28, 37.22) }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.status, "draft");
    assert.equal(created.verified, false);

    // Tekshirilmagan mashina binosini nashr qilishga urinish rad etiladi.
    const failPublish = await fetch(`${baseUrl}/api/buildings/${created.id}/publish`, { method: "POST", headers: auth });
    assert.equal(failPublish.status, 422);

    // Tekshiramiz.
    const verifyRes = await fetch(`${baseUrl}/api/buildings/${created.id}/verify`, { method: "POST", headers: auth });
    assert.equal(verifyRes.status, 200);
    assert.equal((await verifyRes.json()).verified, true);

    // Endi nashr qilinadi.
    const okPublish = await fetch(`${baseUrl}/api/buildings/${created.id}/publish`, { method: "POST", headers: auth });
    assert.equal(okPublish.status, 200);
    assert.equal((await okPublish.json()).status, "published");
  });
});

test("API: viewer faqat nashr qilingan binolarni ko‘radi", async () => {
  await withApi(async ({ baseUrl, buildingRepository }) => {
    const admin = { id: "admin-1", fullName: "Administrator" };
    await buildingRepository.create({ buildingType: "other", source: "manual", geometry: squareAround(67.28, 37.22) }, admin);

    const res = await fetch(`${baseUrl}/api/buildings`); // tokensiz = viewer
    const body = await res.json();
    assert.equal(body.buildings.length, 0); // draft ko‘rinmaydi
  });
});

test("API: ommaviy import (Microsoft/OSM) ishlaydi", async () => {
  await withApi(async ({ baseUrl }) => {
    const token = await login(baseUrl, "admin", "admin123");
    const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const res = await fetch(`${baseUrl}/api/buildings/import`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        source: "microsoft",
        buildings: [
          { geometry: squareAround(67.28, 37.22), sourceConfidence: 0.88 },
          { geometry: squareAround(67.281, 37.221), sourceConfidence: 0.91 },
        ],
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.count, 2);
    assert.equal(body.buildings[0].source, "microsoft");
    assert.equal(body.buildings[0].status, "draft");
  });
});

test("API: viewer bino yarata olmaydi", async () => {
  await withApi(async ({ baseUrl }) => {
    const token = await login(baseUrl, "viewer", "viewer123");
    const res = await fetch(`${baseUrl}/api/buildings`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ buildingType: "other", geometry: squareAround(67.28, 37.22) }),
    });
    assert.equal(res.status, 403);
  });
});
