import { readFile } from "node:fs/promises";
import { ShardedBuildingRepository } from "./sharded-building-repository.mjs";

const VIEWPORT_PREFIX = "__viewport__:";

function parseViewportQuery(query) {
  const text = String(query ?? "");
  if (!text.startsWith(VIEWPORT_PREFIX)) return null;
  const [bboxPart, limitPart] = text.slice(VIEWPORT_PREFIX.length).split(";");
  const bbox = bboxPart.split(",").map(Number);
  if (bbox.length !== 4 || !bbox.every(Number.isFinite)) return null;
  const [west, south, east, north] = bbox;
  if (west > east || south > north) return null;
  const requested = Number(limitPart ?? 6000);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(requested, 12000)) : 6000;
  return { bbox, limit };
}

async function readPrimary(filePath) {
  try {
    const value = JSON.parse((await readFile(filePath, "utf8")) || "[]");
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export class RuntimeBuildingRepository extends ShardedBuildingRepository {
  async list(status = "published", options = {}) {
    if (status === "all" && !options.bbox && Object.keys(options).length === 0) {
      const primary = await readPrimary(this.buildingsFile);
      return primary
        .filter((building) => building.source !== "microsoft")
        .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
    }
    return super.list(status, options);
  }

  async search(query, status = "published", options = {}) {
    const viewport = parseViewportQuery(query);
    if (viewport) return super.list(status, { ...options, ...viewport });
    return super.search(query, status, options);
  }
}
