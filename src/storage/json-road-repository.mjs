import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { canPublishRoad, validateRoadInput } from "../domain/roads.mjs";

export class RoadNotFoundError extends Error {
  constructor() {
    super("Ko‘cha topilmadi");
    this.name = "RoadNotFoundError";
    this.code = "ROAD_NOT_FOUND";
  }
}

export class RoadConflictError extends Error {
  constructor() {
    super("Bu ko‘cha boshqa oynada o‘zgartirilgan");
    this.name = "RoadConflictError";
    this.code = "ROAD_CONFLICT";
  }
}

export class RoadPublishError extends Error {
  constructor(message) {
    super(message);
    this.name = "RoadPublishError";
    this.code = "ROAD_PUBLISH_INVALID";
  }
}

async function ensureJsonFile(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(filePath, "[]\n", "utf8");
  }
}

async function readJson(filePath) {
  await ensureJsonFile(filePath);
  const text = await readFile(filePath, "utf8");
  const value = JSON.parse(text || "[]");
  return Array.isArray(value) ? value : [];
}

async function writeJson(filePath, data) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export class JsonRoadRepository {
  constructor({ roadsFile, logFile }) {
    this.roadsFile = roadsFile;
    this.logFile = logFile;
    this.queue = Promise.resolve();
  }

  async #serialized(operation) {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async list(status = "published") {
    const roads = await readJson(this.roadsFile);
    const filtered = status === "all" ? roads : roads.filter((road) => road.status === status);
    return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getById(id) {
    const roads = await readJson(this.roadsFile);
    return roads.find((road) => road.id === id) ?? null;
  }

  async create(input, actor) {
    const parsed = validateRoadInput(input);
    return this.#serialized(async () => {
      const roads = await readJson(this.roadsFile);
      const now = new Date().toISOString();
      const road = {
        id: randomUUID(),
        ...parsed,
        status: "draft",
        createdBy: actor.id,
        createdByName: actor.fullName,
        createdAt: now,
        updatedAt: now,
      };
      roads.push(road);
      await writeJson(this.roadsFile, roads);
      await this.#appendLog({ roadId: road.id, action: "create", oldData: null, newData: road, actor });
      return road;
    });
  }

  async update(id, input, actor) {
    const parsed = validateRoadInput(input);
    return this.#serialized(async () => {
      const roads = await readJson(this.roadsFile);
      const index = roads.findIndex((road) => road.id === id);
      if (index === -1) throw new RoadNotFoundError();
      const current = roads[index];
      if (parsed.expectedUpdatedAt && parsed.expectedUpdatedAt !== current.updatedAt) {
        throw new RoadConflictError();
      }
      const { expectedUpdatedAt, ...fields } = parsed;
      const updated = {
        ...current,
        ...fields,
        status: current.status === "archived" ? "archived" : fields.status,
        updatedAt: new Date().toISOString(),
      };
      roads[index] = updated;
      await writeJson(this.roadsFile, roads);
      await this.#appendLog({ roadId: id, action: "update", oldData: current, newData: updated, actor });
      return updated;
    });
  }

  async publish(id, actor) {
    return this.#setStatus(id, "published", "publish", actor, (road) => {
      const check = canPublishRoad(road);
      if (!check.ok) throw new RoadPublishError(check.message);
    });
  }

  async archive(id, actor) {
    return this.#setStatus(id, "archived", "archive", actor);
  }

  async restore(id, actor) {
    return this.#setStatus(id, "draft", "restore", actor);
  }

  async search(query, status = "published") {
    const normalized = String(query ?? "").trim().toLocaleLowerCase("uz");
    const roads = await this.list(status);
    if (!normalized) return roads;
    return roads.filter((road) => [road.name, road.districtName, road.neighborhoodName]
      .some((value) => String(value).toLocaleLowerCase("uz").includes(normalized)));
  }

  async #setStatus(id, status, action, actor, beforeChange = undefined) {
    return this.#serialized(async () => {
      const roads = await readJson(this.roadsFile);
      const index = roads.findIndex((road) => road.id === id);
      if (index === -1) throw new RoadNotFoundError();
      const current = roads[index];
      beforeChange?.(current);
      const updated = { ...current, status, updatedAt: new Date().toISOString() };
      roads[index] = updated;
      await writeJson(this.roadsFile, roads);
      await this.#appendLog({ roadId: id, action, oldData: current, newData: updated, actor });
      return updated;
    });
  }

  async #appendLog({ roadId, action, oldData, newData, actor }) {
    const logs = await readJson(this.logFile);
    logs.push({
      id: randomUUID(),
      roadId,
      action,
      oldData,
      newData,
      changedBy: actor.id,
      changedByName: actor.fullName,
      changedAt: new Date().toISOString(),
    });
    await writeJson(this.logFile, logs);
  }
}
