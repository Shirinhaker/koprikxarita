import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { canPublishRegion, validateRegionInput } from "../domain/regions.mjs";

export class RegionNotFoundError extends Error {
  constructor() {
    super("Hudud topilmadi");
    this.name = "RegionNotFoundError";
    this.code = "REGION_NOT_FOUND";
  }
}

export class RegionConflictError extends Error {
  constructor() {
    super("Bu hudud boshqa oynada o‘zgartirilgan");
    this.name = "RegionConflictError";
    this.code = "REGION_CONFLICT";
  }
}

export class RegionPublishError extends Error {
  constructor(message) {
    super(message);
    this.name = "RegionPublishError";
    this.code = "REGION_PUBLISH_INVALID";
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
  await mkdir(path.dirname(filePath), { recursive: true });
  // Hudud geometriyasi katta — chiroyli formatlash fayl hajmini bir necha
  // barobar oshiradi, shuning uchun bu yerda siqib yoziladi.
  await writeFile(tempPath, `${JSON.stringify(data)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export class JsonRegionRepository {
  constructor({ regionsFile, logFile }) {
    this.regionsFile = regionsFile;
    this.logFile = logFile;
    this.queue = Promise.resolve();
  }

  async #serialized(operation) {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async list(status = "published", { level = undefined, parentId = undefined } = {}) {
    const regions = await readJson(this.regionsFile);
    return regions
      .filter((region) => (status === "all" || region.status === status))
      .filter((region) => (level === undefined || region.level === level))
      .filter((region) => (parentId === undefined || region.parentId === parentId))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "uz"));
  }

  async getById(id) {
    const regions = await readJson(this.regionsFile);
    return regions.find((region) => region.id === id) ?? null;
  }

  async create(input, actor) {
    const parsed = validateRegionInput(input);
    return this.#serialized(async () => {
      const regions = await readJson(this.regionsFile);
      const region = this.#build(parsed, actor);
      regions.push(region);
      await writeJson(this.regionsFile, regions);
      await this.#appendLog({ regionId: region.id, action: "create", oldData: null, newData: region, actor });
      return region;
    });
  }

  // Rasmiy manbadan (OSM) qayta import. Bir xil manba + sourceId bo‘yicha
  // mavjud hudud yangilanadi, yangisi qo‘shiladi. Shu tufayli importni
  // xohlagancha qayta ishga tushirish mumkin — dublikat paydo bo‘lmaydi.
  async importMany(inputs, actor, defaults = {}) {
    const parsedAll = inputs.map((input) => validateRegionInput({ ...defaults, ...input }));
    return this.#serialized(async () => {
      const regions = await readJson(this.regionsFile);
      const now = new Date().toISOString();
      const created = [];
      const updated = [];

      for (const parsed of parsedAll) {
        const { expectedUpdatedAt, ...fields } = parsed;
        const index = fields.sourceId
          ? regions.findIndex((region) => region.source === fields.source && region.sourceId === fields.sourceId)
          : -1;

        if (index === -1) {
          const region = this.#build(parsed, actor, now);
          regions.push(region);
          created.push(region);
          continue;
        }

        const current = regions[index];
        const next = { ...current, ...fields, updatedAt: now };
        regions[index] = next;
        updated.push(next);
      }

      await writeJson(this.regionsFile, regions);
      await this.#appendLog({
        regionId: null,
        action: "import_batch",
        oldData: null,
        newData: { created: created.length, updated: updated.length, source: defaults.source ?? null },
        actor,
      });
      return { created: created.length, updated: updated.length, regions: [...created, ...updated] };
    });
  }

  async update(id, input, actor) {
    const parsed = validateRegionInput(input);
    return this.#serialized(async () => {
      const regions = await readJson(this.regionsFile);
      const index = regions.findIndex((region) => region.id === id);
      if (index === -1) throw new RegionNotFoundError();
      const current = regions[index];
      if (parsed.expectedUpdatedAt && parsed.expectedUpdatedAt !== current.updatedAt) {
        throw new RegionConflictError();
      }
      const { expectedUpdatedAt, ...fields } = parsed;
      const next = {
        ...current,
        ...fields,
        status: current.status === "archived" ? "archived" : fields.status,
        updatedAt: new Date().toISOString(),
      };
      regions[index] = next;
      await writeJson(this.regionsFile, regions);
      await this.#appendLog({ regionId: id, action: "update", oldData: current, newData: next, actor });
      return next;
    });
  }

  async publish(id, actor) {
    return this.#setStatus(id, "published", "publish", actor, (region) => {
      const check = canPublishRegion(region);
      if (!check.ok) throw new RegionPublishError(check.message);
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
    const regions = await this.list(status);
    if (!normalized) return regions;
    return regions.filter((region) => [region.name, region.code]
      .some((value) => String(value ?? "").toLocaleLowerCase("uz").includes(normalized)));
  }

  #build(parsed, actor, now = new Date().toISOString()) {
    const { expectedUpdatedAt, ...fields } = parsed;
    return {
      id: randomUUID(),
      ...fields,
      createdBy: actor.id,
      createdByName: actor.fullName,
      createdAt: now,
      updatedAt: now,
    };
  }

  async #setStatus(id, status, action, actor, beforeChange = undefined) {
    return this.#serialized(async () => {
      const regions = await readJson(this.regionsFile);
      const index = regions.findIndex((region) => region.id === id);
      if (index === -1) throw new RegionNotFoundError();
      const current = regions[index];
      beforeChange?.(current);
      const next = { ...current, status, updatedAt: new Date().toISOString() };
      regions[index] = next;
      await writeJson(this.regionsFile, regions);
      await this.#appendLog({ regionId: id, action, oldData: current, newData: next, actor });
      return next;
    });
  }

  // Hudud geometriyasi juda katta — jurnalga to‘liq nusxa yozilsa, fayl
  // tez o‘sib ketadi. Shuning uchun jurnalda geometriya o‘rniga uning
  // qisqacha o‘lchovi saqlanadi.
  async #appendLog({ regionId, action, oldData, newData, actor }) {
    const logs = await readJson(this.logFile);
    logs.push({
      id: randomUUID(),
      regionId,
      action,
      oldData: summarize(oldData),
      newData: summarize(newData),
      changedBy: actor.id,
      changedByName: actor.fullName,
      changedAt: new Date().toISOString(),
    });
    await writeJson(this.logFile, logs);
  }
}

function summarize(value) {
  if (!value || typeof value !== "object") return value;
  const { geometry, ...rest } = value;
  if (!geometry) return rest;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const vertices = polygons.reduce((sum, rings) => sum + rings.reduce((s, ring) => s + ring.length, 0), 0);
  return { ...rest, geometry: { type: geometry.type, vertices } };
}
