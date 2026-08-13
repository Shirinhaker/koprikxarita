import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { canPublishBuilding, validateBuildingInput } from "../domain/buildings.mjs";

export class BuildingNotFoundError extends Error {
  constructor() {
    super("Bino topilmadi");
    this.name = "BuildingNotFoundError";
    this.code = "BUILDING_NOT_FOUND";
  }
}

export class BuildingConflictError extends Error {
  constructor() {
    super("Bu bino boshqa oynada o‘zgartirilgan");
    this.name = "BuildingConflictError";
    this.code = "BUILDING_CONFLICT";
  }
}

export class BuildingPublishError extends Error {
  constructor(message) {
    super(message);
    this.name = "BuildingPublishError";
    this.code = "BUILDING_PUBLISH_INVALID";
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

export class JsonBuildingRepository {
  constructor({ buildingsFile, logFile }) {
    this.buildingsFile = buildingsFile;
    this.logFile = logFile;
    this.queue = Promise.resolve();
  }

  async #serialized(operation) {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async list(status = "published") {
    const buildings = await readJson(this.buildingsFile);
    const filtered = status === "all" ? buildings : buildings.filter((b) => b.status === status);
    return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getById(id) {
    const buildings = await readJson(this.buildingsFile);
    return buildings.find((b) => b.id === id) ?? null;
  }

  async create(input, actor) {
    const parsed = validateBuildingInput(input);
    return this.#serialized(async () => {
      const buildings = await readJson(this.buildingsFile);
      const now = new Date().toISOString();
      const { expectedUpdatedAt, ...fields } = parsed;
      const building = {
        id: randomUUID(),
        ...fields,
        status: "draft",
        createdBy: actor.id,
        createdByName: actor.fullName,
        createdAt: now,
        updatedAt: now,
      };
      buildings.push(building);
      await writeJson(this.buildingsFile, buildings);
      await this.#appendLog({ buildingId: building.id, action: "create", oldData: null, newData: building, actor });
      return building;
    });
  }

  async importMany(inputs, actor, defaults = {}) {
    const parsedList = inputs.map((input) => validateBuildingInput({ ...defaults, ...input }));
    return this.#serialized(async () => {
      const buildings = await readJson(this.buildingsFile);
      const logs = await readJson(this.logFile);
      const now = new Date().toISOString();
      const created = [];
      for (const parsed of parsedList) {
        const { expectedUpdatedAt, ...fields } = parsed;
        const building = {
          id: randomUUID(),
          ...fields,
          status: "draft",
          createdBy: actor.id,
          createdByName: actor.fullName,
          createdAt: now,
          updatedAt: now,
        };
        buildings.push(building);
        logs.push(this.#logEntry({ buildingId: building.id, action: "import", oldData: null, newData: building, actor }));
        created.push(building);
      }
      await writeJson(this.buildingsFile, buildings);
      await writeJson(this.logFile, logs);
      return { count: created.length, buildings: created };
    });
  }

  async update(id, input, actor) {
    const parsed = validateBuildingInput(input);
    return this.#serialized(async () => {
      const buildings = await readJson(this.buildingsFile);
      const index = buildings.findIndex((b) => b.id === id);
      if (index === -1) throw new BuildingNotFoundError();
      const current = buildings[index];
      if (parsed.expectedUpdatedAt && parsed.expectedUpdatedAt !== current.updatedAt) {
        throw new BuildingConflictError();
      }
      const { expectedUpdatedAt, ...fields } = parsed;
      const updated = {
        ...current,
        ...fields,
        status: current.status === "archived" ? "archived" : fields.status,
        updatedAt: new Date().toISOString(),
      };
      buildings[index] = updated;
      await writeJson(this.buildingsFile, buildings);
      await this.#appendLog({ buildingId: id, action: "update", oldData: current, newData: updated, actor });
      return updated;
    });
  }

  async setVerified(id, verified, actor) {
    return this.#serialized(async () => {
      const buildings = await readJson(this.buildingsFile);
      const index = buildings.findIndex((b) => b.id === id);
      if (index === -1) throw new BuildingNotFoundError();
      const current = buildings[index];
      const updated = { ...current, verified: Boolean(verified), updatedAt: new Date().toISOString() };
      buildings[index] = updated;
      await writeJson(this.buildingsFile, buildings);
      await this.#appendLog({ buildingId: id, action: verified ? "verify" : "unverify", oldData: current, newData: updated, actor });
      return updated;
    });
  }

  async publish(id, actor) {
    return this.#setStatus(id, "published", "publish", actor, (building) => {
      const check = canPublishBuilding(building);
      if (!check.ok) throw new BuildingPublishError(check.message);
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
    const buildings = await this.list(status);
    if (!normalized) return buildings;
    return buildings.filter((b) => [b.name, b.districtName, b.neighborhoodName]
      .some((value) => String(value).toLocaleLowerCase("uz").includes(normalized)));
  }

  async #setStatus(id, status, action, actor, beforeChange = undefined) {
    return this.#serialized(async () => {
      const buildings = await readJson(this.buildingsFile);
      const index = buildings.findIndex((b) => b.id === id);
      if (index === -1) throw new BuildingNotFoundError();
      const current = buildings[index];
      beforeChange?.(current);
      const updated = { ...current, status, updatedAt: new Date().toISOString() };
      buildings[index] = updated;
      await writeJson(this.buildingsFile, buildings);
      await this.#appendLog({ buildingId: id, action, oldData: current, newData: updated, actor });
      return updated;
    });
  }

  #logEntry({ buildingId, action, oldData, newData, actor }) {
    return {
      id: randomUUID(),
      buildingId,
      action,
      oldData,
      newData,
      changedBy: actor.id,
      changedByName: actor.fullName,
      changedAt: new Date().toISOString(),
    };
  }

  async #appendLog(entry) {
    const logs = await readJson(this.logFile);
    logs.push(this.#logEntry(entry));
    await writeJson(this.logFile, logs);
  }
}
