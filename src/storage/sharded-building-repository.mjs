import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { canPublishBuilding, validateBuildingInput } from "../domain/buildings.mjs";

import {
  BuildingConflictError,
  BuildingNotFoundError,
  BuildingPublishError,
} from "./json-building-errors.mjs";

const CELL_SIZE = 0.02;
const WORLD_WEST = -180;
const WORLD_SOUTH = -90;
const META_FILE = "meta.json";
const DEFAULT_LIMIT = 6000;

async function ensureJsonFile(filePath, initial = "[]\n") {
  await mkdir(path.dirname(filePath), { recursive: true });
  try { await readFile(filePath, "utf8"); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(filePath, initial, "utf8");
  }
}

async function readJsonArray(filePath) {
  await ensureJsonFile(filePath);
  const value = JSON.parse((await readFile(filePath, "utf8")) || "[]");
  return Array.isArray(value) ? value : [];
}

async function readJsonArrayIfExists(filePath) {
  try {
    const value = JSON.parse((await readFile(filePath, "utf8")) || "[]");
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function readMeta(filePath) {
  await ensureJsonFile(filePath, '{"microsoftCount":0}\n');
  const value = JSON.parse((await readFile(filePath, "utf8")) || "{}");
  return value && typeof value === "object" ? value : { microsoftCount: 0 };
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, filePath);
}

function geometryBounds(geometry) {
  const ring = geometry?.coordinates?.[0] ?? [];
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const [lng, lat] of ring) {
    west = Math.min(west, lng); south = Math.min(south, lat);
    east = Math.max(east, lng); north = Math.max(north, lat);
  }
  return { west, south, east, north };
}

function geometryCentroid(geometry) {
  const ring = geometry?.coordinates?.[0] ?? [];
  const points = ring.length > 1 ? ring.slice(0, -1) : ring;
  if (!points.length) return [0, 0];
  let lng = 0; let lat = 0;
  for (const point of points) { lng += point[0]; lat += point[1]; }
  return [lng / points.length, lat / points.length];
}

function normalizeBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const values = bbox.map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [west, south, east, north] = values;
  if (west > east || south > north) return null;
  return { west, south, east, north };
}

function boundsIntersect(a, b) {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

function cellIndex(lng, lat) {
  return {
    x: Math.floor((lng - WORLD_WEST) / CELL_SIZE),
    y: Math.floor((lat - WORLD_SOUTH) / CELL_SIZE),
  };
}

function cellKeyFromGeometry(geometry) {
  const [lng, lat] = geometryCentroid(geometry);
  const { x, y } = cellIndex(lng, lat);
  return `${x}_${y}`;
}

function cellKeysForBbox(bbox) {
  const normalized = normalizeBbox(bbox);
  if (!normalized) return [];
  const start = cellIndex(normalized.west, normalized.south);
  const end = cellIndex(normalized.east, normalized.north);
  const keys = [];
  const maxCells = 1200;
  for (let x = start.x; x <= end.x; x += 1) {
    for (let y = start.y; y <= end.y; y += 1) {
      keys.push(`${x}_${y}`);
      if (keys.length >= maxCells) return keys;
    }
  }
  return keys;
}

function sourceFingerprint(parsed) {
  const ring = parsed.geometry.coordinates[0];
  const normalized = ring.map(([lng, lat]) => [Number(lng.toFixed(6)), Number(lat.toFixed(6))]);
  return createHash("sha1").update(JSON.stringify(normalized)).digest("hex").slice(0, 20);
}

function shardId(cellKey) {
  return `ms_${cellKey}_${randomUUID()}`;
}

function shardKeyFromId(id) {
  const match = /^ms_(-?\d+_-?\d+)_/.exec(String(id));
  return match?.[1] ?? null;
}

export class ShardedBuildingRepository {
  constructor({ buildingsFile, logFile, shardsDir = path.join(path.dirname(buildingsFile), "building-shards") }) {
    this.buildingsFile = buildingsFile;
    this.logFile = logFile;
    this.shardsDir = shardsDir;
    this.metaFile = path.join(shardsDir, META_FILE);
    this.queue = Promise.resolve();
  }

  shardFile(key) { return path.join(this.shardsDir, `cell-${key}.json`); }

  async #serialized(operation) {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async #readShard(key) {
    return readJsonArrayIfExists(this.shardFile(key));
  }

  async #allShardKeys() {
    try {
      const files = await readdir(this.shardsDir);
      return files
        .filter((name) => /^cell-.*\.json$/.test(name))
        .map((name) => name.slice(5, -5));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async list(status = "published", options = {}) {
    const bbox = normalizeBbox(options.bbox);
    const limit = Math.max(1, Math.min(Number(options.limit ?? DEFAULT_LIMIT), 20000));
    const primary = await readJsonArray(this.buildingsFile);
    const primaryFiltered = primary.filter((building) => {
      if (status !== "all" && building.status !== status) return false;
      return !bbox || boundsIntersect(geometryBounds(building.geometry), bbox);
    });

    const shardKeys = bbox ? cellKeysForBbox(options.bbox) : await this.#allShardKeys();
    const result = primaryFiltered.slice(0, limit);
    for (const key of shardKeys) {
      if (result.length >= limit) break;
      const buildings = await this.#readShard(key);
      for (const building of buildings) {
        if (status !== "all" && building.status !== status) continue;
        if (bbox && !boundsIntersect(geometryBounds(building.geometry), bbox)) continue;
        result.push(building);
        if (result.length >= limit) break;
      }
    }
    return result.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  }

  async countBySource(source) {
    const primary = await readJsonArray(this.buildingsFile);
    let count = primary.filter((building) => building.source === source && building.status !== "archived").length;
    if (source === "microsoft") {
      const meta = await readMeta(this.metaFile);
      count += Number(meta.microsoftCount ?? 0);
    }
    return count;
  }

  async getById(id) {
    const key = shardKeyFromId(id);
    if (key) {
      const shard = await this.#readShard(key);
      return shard.find((building) => building.id === id) ?? null;
    }
    const primary = await readJsonArray(this.buildingsFile);
    return primary.find((building) => building.id === id) ?? null;
  }

  async create(input, actor) {
    const parsed = validateBuildingInput(input);
    return this.#serialized(async () => {
      const buildings = await readJsonArray(this.buildingsFile);
      const now = new Date().toISOString();
      const { expectedUpdatedAt, ...fields } = parsed;
      const building = {
        id: randomUUID(), ...fields, status: "draft",
        createdBy: actor.id, createdByName: actor.fullName, createdAt: now, updatedAt: now,
      };
      buildings.push(building);
      await writeJson(this.buildingsFile, buildings);
      await this.#appendLog({ buildingId: building.id, action: "create", oldData: null, newData: building, actor });
      return building;
    });
  }

  async importMany(inputs, actor, defaults = {}) {
    const parsedList = inputs.map((input) => validateBuildingInput({ ...defaults, ...input }));
    if (defaults.source !== "microsoft") {
      const created = [];
      for (const parsed of parsedList) created.push(await this.create(parsed, actor));
      return { count: created.length, skipped: 0, buildings: created };
    }

    return this.#serialized(async () => {
      // Asosiy fayl kichik qo‘lda yaratilgan binolar uchun doim mavjud bo‘lsin.
      await ensureJsonFile(this.buildingsFile);
      const groups = new Map();
      for (const parsed of parsedList) {
        const key = cellKeyFromGeometry(parsed.geometry);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(parsed);
      }

      const now = new Date().toISOString();
      const created = [];
      let skipped = 0;
      for (const [key, parsedItems] of groups) {
        const shard = await this.#readShard(key);
        const fingerprints = new Set(shard.map((building) => building.sourceKey).filter(Boolean));
        for (const parsed of parsedItems) {
          const fingerprint = sourceFingerprint(parsed);
          if (fingerprints.has(fingerprint)) { skipped += 1; continue; }
          const { expectedUpdatedAt, ...fields } = parsed;
          const building = {
            id: shardId(key), ...fields, sourceKey: fingerprint, status: "draft",
            createdBy: actor.id, createdByName: actor.fullName, createdAt: now, updatedAt: now,
          };
          shard.push(building);
          created.push(building);
          fingerprints.add(fingerprint);
        }
        await writeJson(this.shardFile(key), shard);
      }

      if (created.length) {
        const meta = await readMeta(this.metaFile);
        meta.microsoftCount = Number(meta.microsoftCount ?? 0) + created.length;
        meta.updatedAt = now;
        await writeJson(this.metaFile, meta);
        await this.#appendLog({
          buildingId: null,
          action: "import_batch",
          oldData: null,
          newData: { source: "microsoft", count: created.length, skipped, shardCount: groups.size },
          actor,
        });
      }
      return { count: created.length, skipped, buildings: created };
    });
  }

  async update(id, input, actor) {
    const parsed = validateBuildingInput(input);
    return this.#mutate(id, actor, "update", (current) => {
      if (parsed.expectedUpdatedAt && parsed.expectedUpdatedAt !== current.updatedAt) throw new BuildingConflictError();
      const { expectedUpdatedAt, ...fields } = parsed;
      return { ...current, ...fields, status: current.status === "archived" ? "archived" : fields.status, updatedAt: new Date().toISOString() };
    });
  }

  async setVerified(id, verified, actor) {
    return this.#mutate(id, actor, verified ? "verify" : "unverify", (current) => ({
      ...current, verified: Boolean(verified), updatedAt: new Date().toISOString(),
    }));
  }

  async publish(id, actor) {
    return this.#mutate(id, actor, "publish", (current) => {
      const check = canPublishBuilding(current);
      if (!check.ok) throw new BuildingPublishError(check.message);
      return { ...current, status: "published", updatedAt: new Date().toISOString() };
    });
  }

  async archive(id, actor) {
    return this.#mutate(id, actor, "archive", (current) => ({ ...current, status: "archived", updatedAt: new Date().toISOString() }));
  }

  async restore(id, actor) {
    return this.#mutate(id, actor, "restore", (current) => ({ ...current, status: "draft", updatedAt: new Date().toISOString() }));
  }

  async search(query, status = "published", options = {}) {
    const normalized = String(query ?? "").trim().toLocaleLowerCase("uz");
    const buildings = await this.list(status, options);
    if (!normalized) return buildings;
    return buildings.filter((building) => [building.name, building.districtName, building.neighborhoodName]
      .some((value) => String(value ?? "").toLocaleLowerCase("uz").includes(normalized)));
  }

  async #mutate(id, actor, action, mutate) {
    return this.#serialized(async () => {
      const key = shardKeyFromId(id);
      const filePath = key ? this.shardFile(key) : this.buildingsFile;
      const buildings = await readJsonArray(filePath);
      const index = buildings.findIndex((building) => building.id === id);
      if (index === -1) throw new BuildingNotFoundError();
      const current = buildings[index];
      const updated = mutate(current);
      buildings[index] = updated;
      await writeJson(filePath, buildings);
      await this.#appendLog({ buildingId: id, action, oldData: current, newData: updated, actor });
      return updated;
    });
  }

  #logEntry({ buildingId, action, oldData, newData, actor }) {
    return {
      id: randomUUID(), buildingId, action, oldData, newData,
      changedBy: actor.id, changedByName: actor.fullName, changedAt: new Date().toISOString(),
    };
  }

  async #appendLog(entry) {
    const logs = await readJsonArray(this.logFile);
    logs.push(this.#logEntry(entry));
    await writeJson(this.logFile, logs);
  }
}
