import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import { createKoprikServer } from "../apps/api/src/server.mjs";
import { JsonRoadRepository } from "../src/storage/json-road-repository.mjs";

const directory = await mkdtemp(path.join(tmpdir(), "koprik-smoke-"));
const repository = new JsonRoadRepository({ roadsFile: path.join(directory, "roads.json"), logFile: path.join(directory, "logs.json") });
const server = createKoprikServer({
  repository,
  jwtSecret: "smoke-secret",
  publicDir: path.resolve("apps/web/public"),
  users: [{ id: "admin", fullName: "Admin", login: "admin", password: "admin12345", role: "admin" }],
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;

try {
  const loginResponse = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: "admin", password: "admin12345" }) });
  assert.equal(loginResponse.status, 200);
  const token = (await loginResponse.json()).token;
  const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
  const input = {
    name: "Smoke test ko‘chasi", roadType: "residential", surface: "asphalt", direction: "two_way", status: "draft",
    districtName: "Qumqo‘rg‘on", neighborhoodName: "Sinov", geometry: { type: "LineString", coordinates: [[67.2, 37.8], [67.21, 37.81]] },
  };
  const createResponse = await fetch(`${base}/api/roads`, { method: "POST", headers, body: JSON.stringify(input) });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  const updateResponse = await fetch(`${base}/api/roads/${created.id}`, { method: "PUT", headers, body: JSON.stringify({ ...input, name: "Yangilangan smoke ko‘chasi", expectedUpdatedAt: created.updatedAt }) });
  assert.equal(updateResponse.status, 200);
  const publishResponse = await fetch(`${base}/api/roads/${created.id}/publish`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  assert.equal(publishResponse.status, 200);
  const searchResponse = await fetch(`${base}/api/roads/search?q=Yangilangan`);
  assert.equal((await searchResponse.json()).roads.length, 1);
  const archiveResponse = await fetch(`${base}/api/roads/${created.id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
  assert.equal(archiveResponse.status, 200);
  const restoreResponse = await fetch(`${base}/api/roads/${created.id}/restore`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  assert.equal(restoreResponse.status, 200);
  console.log("Ko‘prik Xarita smoke test: PASS");
} finally {
  server.close();
  await once(server, "close");
  await rm(directory, { recursive: true, force: true });
}
