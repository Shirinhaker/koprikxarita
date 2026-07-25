import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createKoprikServer } from "../apps/api/src/server.mjs";
import { JsonRoadRepository } from "../src/storage/json-road-repository.mjs";

async function withApi(callback) {
  const directory = await mkdtemp(path.join(tmpdir(), "koprik-api-"));
  const repository = new JsonRoadRepository({
    roadsFile: path.join(directory, "roads.json"),
    logFile: path.join(directory, "logs.json"),
  });
  const server = createKoprikServer({
    repository,
    jwtSecret: "test-secret",
    publicDir: path.resolve("apps/web/public"),
    users: [
      { id: "admin-1", fullName: "Administrator", login: "admin", password: "admin123", role: "admin" },
      { id: "viewer-1", fullName: "Tomoshabin", login: "viewer", password: "viewer123", role: "viewer" },
    ],
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await callback({ baseUrl, repository });
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

const validRoad = {
  name: "Mustaqillik ko‘chasi",
  roadType: "residential",
  surface: "asphalt",
  direction: "two_way",
  status: "draft",
  districtName: "Qumqo‘rg‘on",
  neighborhoodName: "Markaz",
  geometry: { type: "LineString", coordinates: [[67.3, 37.9], [67.301, 37.901]] },
};

test("noto‘g‘ri login 401 qaytaradi", async () => {
  await withApi(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "admin", password: "xato" }),
    });
    assert.equal(response.status, 401);
  });
});

test("viewer ko‘cha yarata olmaydi", async () => {
  await withApi(async ({ baseUrl }) => {
    const token = await login(baseUrl, "viewer", "viewer123");
    const response = await fetch(`${baseUrl}/api/roads`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(validRoad),
    });
    assert.equal(response.status, 403);
  });
});

test("admin ko‘cha yaratadi, nashr qiladi va qidiruvda topadi", async () => {
  await withApi(async ({ baseUrl }) => {
    const token = await login(baseUrl, "admin", "admin123");
    const createResponse = await fetch(`${baseUrl}/api/roads`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(validRoad),
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();

    const publishResponse = await fetch(`${baseUrl}/api/roads/${created.id}/publish`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(publishResponse.status, 200);

    const searchResponse = await fetch(`${baseUrl}/api/roads/search?q=Mustaqillik`);
    assert.equal(searchResponse.status, 200);
    const result = await searchResponse.json();
    assert.equal(result.roads.length, 1);
    assert.equal(result.geojson.features[0].properties.name, "Mustaqillik ko‘chasi");
  });
});

test("nomsiz draftni nashr qilish 422 qaytaradi", async () => {
  await withApi(async ({ baseUrl }) => {
    const token = await login(baseUrl, "admin", "admin123");
    const createResponse = await fetch(`${baseUrl}/api/roads`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...validRoad, name: "" }),
    });
    const created = await createResponse.json();
    const response = await fetch(`${baseUrl}/api/roads/${created.id}/publish`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 422);
  });
});
