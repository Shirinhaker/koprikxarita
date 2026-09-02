import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createKoprikServer } from "../apps/api/src/server.mjs";
import { JsonRoadRepository } from "../src/storage/json-road-repository.mjs";
import { JsonRegionRepository } from "../src/storage/json-region-repository.mjs";

async function withApi(callback) {
  const directory = await mkdtemp(path.join(tmpdir(), "koprik-regions-api-"));
  const repository = new JsonRoadRepository({
    roadsFile: path.join(directory, "roads.json"),
    logFile: path.join(directory, "road-logs.json"),
  });
  const regionRepository = new JsonRegionRepository({
    regionsFile: path.join(directory, "regions.json"),
    logFile: path.join(directory, "region-logs.json"),
  });
  const server = createKoprikServer({
    repository,
    regionRepository,
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
    await callback({ baseUrl, regionRepository });
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
  assert.equal(response.status, 200);
  return (await response.json()).token;
}

const square = (west, south, size = 0.1) => ({
  type: "Polygon",
  coordinates: [[
    [west, south],
    [west + size, south],
    [west + size, south + size],
    [west, south + size],
    [west, south],
  ]],
});

const viloyat = (name = "Surxondaryo", geometry = square(66.9, 37.3, 1.5)) => ({
  name,
  level: "viloyat",
  source: "osm",
  sourceId: `relation/v-${name}`,
  colorIndex: 5,
  geometry,
});

const tuman = (name = "Denov", geometry = square(67.2, 37.9), parentId = "viloyat-1") => ({
  name,
  level: "tuman",
  parentId,
  source: "osm",
  sourceId: `relation/${name}`,
  geometry,
});

test("import faqat administratorga ochiq", async () => {
  await withApi(async ({ baseUrl }) => {
    const anonymous = await fetch(`${baseUrl}/api/regions/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ regions: [tuman()] }),
    });
    assert.equal(anonymous.status, 401);

    const viewerToken = await login(baseUrl, "viewer", "viewer123");
    const viewer = await fetch(`${baseUrl}/api/regions/import`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${viewerToken}` },
      body: JSON.stringify({ regions: [tuman()] }),
    });
    assert.equal(viewer.status, 403);
  });
});

test("import qilingan tumanlar hammaga ko‘rinadi", async () => {
  await withApi(async ({ baseUrl }) => {
    const token = await login(baseUrl, "admin", "admin123");
    const imported = await fetch(`${baseUrl}/api/regions/import`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ regions: [viloyat(), tuman("Denov"), tuman("Boysun", square(67.5, 38.1))] }),
    });
    assert.equal(imported.status, 201);
    const importBody = await imported.json();
    assert.equal(importBody.created, 3);
    // Javob yengil bo‘lishi kerak — geometriya qaytarilmaydi.
    assert.equal(importBody.regions[0].geometry, undefined);

    const anonymous = await fetch(`${baseUrl}/api/regions`);
    assert.equal(anonymous.status, 200);
    const body = await anonymous.json();
    assert.equal(body.regions.length, 3);
    assert.equal(body.geojson.features.length, 3);
    assert.equal(body.labels.features.length, 3);
    // Rang raqami GeoJSON xossalariga ham tushishi kerak — xarita shunga
    // qarab viloyat rangini tanlaydi.
    const viloyatFeature = body.geojson.features.find((f) => f.properties.level === "viloyat");
    assert.equal(viloyatFeature.properties.colorIndex, 5);
    assert.equal(body.labels.features[0].geometry.type, "Point");
  });
});

test("bo‘sh import 422 qaytaradi", async () => {
  await withApi(async ({ baseUrl }) => {
    const token = await login(baseUrl, "admin", "admin123");
    const response = await fetch(`${baseUrl}/api/regions/import`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ regions: [] }),
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, "REGION_IMPORT_EMPTY");
  });
});

test("draft hudud oddiy foydalanuvchiga ko‘rinmaydi", async () => {
  await withApi(async ({ baseUrl }) => {
    const token = await login(baseUrl, "admin", "admin123");
    const created = await fetch(`${baseUrl}/api/regions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(tuman()),
    });
    assert.equal(created.status, 201);
    const region = await created.json();
    assert.equal(region.status, "draft");

    const anonymous = await fetch(`${baseUrl}/api/regions`);
    assert.equal((await anonymous.json()).regions.length, 0);

    // Admin "all" so‘rasa ko‘radi.
    const asAdmin = await fetch(`${baseUrl}/api/regions?status=all`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal((await asAdmin.json()).regions.length, 1);

    // Oddiy foydalanuvchi "all" so‘rasa ham faqat nashr qilinganini oladi.
    const forced = await fetch(`${baseUrl}/api/regions?status=all`);
    assert.equal((await forced.json()).regions.length, 0);
  });
});

test("daraja bo‘yicha filtr API darajasida ishlaydi", async () => {
  await withApi(async ({ baseUrl, regionRepository }) => {
    const token = await login(baseUrl, "admin", "admin123");
    await fetch(`${baseUrl}/api/regions/import`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ regions: [viloyat()] }),
    });
    const [parentViloyat] = await regionRepository.list("published", { level: "viloyat" });
    await fetch(`${baseUrl}/api/regions/import`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ regions: [tuman("Denov", square(67.2, 37.9), parentViloyat.id)] }),
    });
    const [parent] = await regionRepository.list("published", { level: "tuman" });
    await fetch(`${baseUrl}/api/regions/import`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        regions: [{
          name: "Mustaqillik",
          level: "mahalla",
          parentId: parent.id,
          source: "manual",
          sourceId: "manual/mustaqillik",
          geometry: square(67.21, 37.91, 0.01),
        }],
        source: "manual",
      }),
    });

    const onlyTuman = await fetch(`${baseUrl}/api/regions?level=tuman`);
    assert.equal((await onlyTuman.json()).regions.length, 1);
    const onlyMahalla = await fetch(`${baseUrl}/api/regions?level=mahalla`);
    assert.equal((await onlyMahalla.json()).regions.length, 1);
  });
});

test("noto‘g‘ri geometriya 422 va tushunarli kod qaytaradi", async () => {
  await withApi(async ({ baseUrl }) => {
    const token = await login(baseUrl, "admin", "admin123");
    const response = await fetch(`${baseUrl}/api/regions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...tuman(), geometry: { type: "LineString", coordinates: [[67, 37], [68, 38]] } }),
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, "REGION_GEOMETRY_INVALID");
  });
});

test("nashr va arxiv yo‘nalishlari ishlaydi", async () => {
  await withApi(async ({ baseUrl }) => {
    const token = await login(baseUrl, "admin", "admin123");
    const auth = { "content-type": "application/json", authorization: `Bearer ${token}` };
    const created = await (await fetch(`${baseUrl}/api/regions`, {
      method: "POST", headers: auth, body: JSON.stringify(tuman()),
    })).json();

    const published = await fetch(`${baseUrl}/api/regions/${created.id}/publish`, { method: "POST", headers: auth });
    assert.equal(published.status, 200);
    assert.equal((await published.json()).status, "published");

    const archived = await fetch(`${baseUrl}/api/regions/${created.id}`, { method: "DELETE", headers: auth });
    assert.equal(archived.status, 200);
    assert.equal((await archived.json()).status, "archived");

    const restored = await fetch(`${baseUrl}/api/regions/${created.id}/restore`, { method: "POST", headers: auth });
    assert.equal((await restored.json()).status, "draft");
  });
});

test("mavjud bo‘lmagan hudud 404 qaytaradi", async () => {
  await withApi(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/regions/yoq-bunday-id`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, "REGION_NOT_FOUND");
  });
});

test("regionRepository ulanmagan bo‘lsa API 404 beradi, server yiqilmaydi", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "koprik-noregions-"));
  const server = createKoprikServer({
    repository: new JsonRoadRepository({
      roadsFile: path.join(directory, "roads.json"),
      logFile: path.join(directory, "logs.json"),
    }),
    jwtSecret: "test-secret",
    publicDir: path.resolve("apps/web/public"),
    users: [],
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/regions`);
    assert.equal(response.status, 404);
  } finally {
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
  }
});

// ---- bbox bo'yicha yuklash ----
// 206 ta tumanning to'liq geometriyasi ~1.7 MB. Sahifa ochilishida uni
// yuklamaslik uchun tuman qatlami faqat ko'rinayotgan hudud uchun
// so'raladi. Bu __viewport__ kabi yashirin matn emas, haqiqiy parametr.

test("bbox faqat kesishadigan hududlarni qaytaradi", async () => {
  await withApi(async ({ baseUrl }) => {
    const token = await login(baseUrl, "admin", "admin123");
    await fetch(`${baseUrl}/api/regions/import`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        regions: [
          viloyat("Surxondaryo", square(67.0, 37.5, 1)),
          viloyat("Xorazm", square(60.0, 41.0, 1)),
        ],
      }),
    });

    const hammasi = await (await fetch(`${baseUrl}/api/regions`)).json();
    assert.equal(hammasi.regions.length, 2);

    const janub = await (await fetch(`${baseUrl}/api/regions?bbox=66.8,37.4,68.2,38.6`)).json();
    assert.equal(janub.regions.length, 1);
    assert.equal(janub.regions[0].name, "Surxondaryo");

    const uzoq = await (await fetch(`${baseUrl}/api/regions?bbox=70.0,44.0,71.0,45.0`)).json();
    assert.equal(uzoq.regions.length, 0);
  });
});

test("buzuq bbox jimgina hamma narsani qaytarmaydi, xato beradi", async () => {
  await withApi(async ({ baseUrl }) => {
    for (const bad of ["salom", "1,2,3", "68,37,66,38"]) {
      const response = await fetch(`${baseUrl}/api/regions?bbox=${encodeURIComponent(bad)}`);
      assert.equal(response.status, 422, `bbox=${bad}`);
      assert.equal((await response.json()).code, "REGION_BBOX_INVALID");
    }
  });
});

test("limit qaytariladigan hudud sonini cheklaydi", async () => {
  await withApi(async ({ baseUrl }) => {
    const token = await login(baseUrl, "admin", "admin123");
    await fetch(`${baseUrl}/api/regions/import`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        regions: [viloyat("A", square(66, 37, 1)), viloyat("B", square(68, 39, 1)), viloyat("C", square(70, 41, 1))],
      }),
    });
    const body = await (await fetch(`${baseUrl}/api/regions?limit=2`)).json();
    assert.equal(body.regions.length, 2);
  });
});

test("davlat darajasi niqob uchun alohida so‘raladi", async () => {
  await withApi(async ({ baseUrl }) => {
    const token = await login(baseUrl, "admin", "admin123");
    await fetch(`${baseUrl}/api/regions/import`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        regions: [
          { name: "O‘zbekiston", level: "davlat", source: "osm", sourceId: "relation/196240", geometry: square(56, 37, 17) },
          viloyat(),
        ],
      }),
    });
    const davlat = await (await fetch(`${baseUrl}/api/regions?level=davlat`)).json();
    assert.equal(davlat.regions.length, 1);
    assert.equal(davlat.regions[0].name, "O‘zbekiston");
    assert.equal(davlat.regions[0].parentId, null, "davlat yuqori hududsiz");
  });
});
