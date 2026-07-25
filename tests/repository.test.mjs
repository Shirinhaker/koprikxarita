import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { JsonRoadRepository, RoadConflictError } from "../src/storage/json-road-repository.mjs";

const actor = { id: "admin-1", fullName: "Administrator", role: "admin" };
const input = {
  name: "Bog‘ ko‘chasi",
  roadType: "service",
  surface: "ground",
  direction: "two_way",
  status: "draft",
  districtName: "Qumqo‘rg‘on",
  neighborhoodName: "Bog‘ mahalla",
  geometry: { type: "LineString", coordinates: [[67.2, 37.8], [67.201, 37.801]] },
};

async function withRepository(callback) {
  const directory = await mkdtemp(path.join(tmpdir(), "koprik-xarita-"));
  const repository = new JsonRoadRepository({
    roadsFile: path.join(directory, "roads.json"),
    logFile: path.join(directory, "road-change-log.json"),
  });
  try {
    await callback(repository);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("yaratilgan ko‘cha keyingi o‘qishda saqlanib qoladi", async () => {
  await withRepository(async (repository) => {
    const created = await repository.create(input, actor);
    const loaded = await repository.getById(created.id);
    assert.equal(loaded.name, "Bog‘ ko‘chasi");
  });
});

test("eski updatedAt bilan tahrirlash ziddiyat qaytaradi", async () => {
  await withRepository(async (repository) => {
    const created = await repository.create(input, actor);
    const updated = await repository.update(created.id, { ...input, name: "Yangi nom", expectedUpdatedAt: created.updatedAt }, actor);
    assert.equal(updated.name, "Yangi nom");
    await assert.rejects(
      repository.update(created.id, { ...input, name: "Eski so‘rov", expectedUpdatedAt: created.updatedAt }, actor),
      (error) => error instanceof RoadConflictError,
    );
  });
});

test("arxivlangan ko‘cha published ro‘yxatida ko‘rinmaydi va tiklanadi", async () => {
  await withRepository(async (repository) => {
    const created = await repository.create(input, actor);
    await repository.update(created.id, { ...input, name: "Bog‘ ko‘chasi", expectedUpdatedAt: created.updatedAt }, actor);
    await repository.publish(created.id, actor);
    await repository.archive(created.id, actor);
    assert.equal((await repository.list("published")).length, 0);
    const restored = await repository.restore(created.id, actor);
    assert.equal(restored.status, "draft");
  });
});
