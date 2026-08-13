// Bino domeni — yo‘llar (roads.mjs) uslubida, lekin Polygon geometriya uchun.
// Qo‘shimcha: manba (source) va tekshirilgan (verified) maydonlari —
// Microsoft / OSM / qo‘lda chizilgan binolarni ajratish va tekshiruv oqimi uchun.

export const BUILDING_TYPES = [
  "residential", // turar-joy
  "commercial",  // savdo/tijorat
  "industrial",  // sanoat
  "public",      // jamoat
  "religious",   // diniy
  "education",   // ta’lim
  "health",      // sog‘liqni saqlash
  "other",       // boshqa
];

export const BUILDING_MATERIALS = [
  "brick",    // g‘isht
  "concrete", // beton
  "panel",    // panel
  "wood",     // yog‘och
  "metal",    // metall
  "stone",    // tosh
  "other",    // boshqa
  "unknown",  // noma’lum
];

export const BUILDING_STATUSES = ["draft", "published", "archived"];

// Bino qayerdan kelgani — attribution va tekshiruv uchun juda muhim.
export const BUILDING_SOURCES = ["manual", "osm", "microsoft", "other"];

// Sanity chegaralari (m²). Import qilingan mashina ma’lumotini bloklamaslik
// uchun kengroq qilingan; faqat aynan buzuq (deyarli nol) poligonni rad etadi.
export const BUILDING_MIN_AREA_SQM = 1;
export const BUILDING_MAX_AREA_SQM = 2_000_000;
export const BUILDING_MAX_VERTICES = 10_000;

export class BuildingValidationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "BuildingValidationError";
    this.code = code;
    this.details = details;
  }
}

function requireEnum(value, allowed, field, label) {
  if (!allowed.includes(value)) {
    throw new BuildingValidationError("BUILDING_FIELD_INVALID", `${label} noto‘g‘ri`, { field, allowed });
  }
  return value;
}

function requireText(value, field, maxLength) {
  if (typeof value !== "string") {
    throw new BuildingValidationError("BUILDING_FIELD_INVALID", `${field} matn bo‘lishi kerak`, { field });
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw new BuildingValidationError("BUILDING_FIELD_TOO_LONG", `${field} juda uzun`, { field, maxLength });
  }
  return text;
}

function optionalLevels(value) {
  if (value === undefined || value === null || value === "") return null;
  const levels = Number(value);
  if (!Number.isInteger(levels) || levels < 0 || levels > 200) {
    throw new BuildingValidationError("BUILDING_LEVELS_INVALID", "Qavatlar soni 0–200 oralig‘ida butun son bo‘lishi kerak", { field: "levels" });
  }
  return levels;
}

function optionalConfidence(value) {
  if (value === undefined || value === null || value === "") return null;
  const conf = Number(value);
  if (!Number.isFinite(conf) || conf < 0 || conf > 1) {
    throw new BuildingValidationError("BUILDING_CONFIDENCE_INVALID", "Ishonch qiymati 0–1 oralig‘ida bo‘lishi kerak", { field: "sourceConfidence" });
  }
  return Number(conf.toFixed(4));
}

function cleanPosition(position, ringIndex, pointIndex) {
  if (!Array.isArray(position) || position.length < 2) {
    throw new BuildingValidationError("BUILDING_POSITION_INVALID", `${ringIndex + 1}-halqa, ${pointIndex + 1}-nuqta noto‘g‘ri`);
  }
  const lng = Number(position[0]);
  const lat = Number(position[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    throw new BuildingValidationError("BUILDING_POSITION_INVALID", `${ringIndex + 1}-halqa, ${pointIndex + 1}-nuqta koordinatasi noto‘g‘ri`);
  }
  return [Number(lng.toFixed(7)), Number(lat.toFixed(7))];
}

function validatePolygon(geometry) {
  if (!geometry || geometry.type !== "Polygon" || !Array.isArray(geometry.coordinates)) {
    throw new BuildingValidationError("BUILDING_GEOMETRY_INVALID", "Geometriya Polygon bo‘lishi kerak");
  }
  if (geometry.coordinates.length < 1) {
    throw new BuildingValidationError("BUILDING_GEOMETRY_INVALID", "Binoda kamida bitta tashqi halqa bo‘lishi kerak");
  }

  let totalVertices = 0;
  const rings = geometry.coordinates.map((ring, ringIndex) => {
    if (!Array.isArray(ring) || ring.length < 4) {
      throw new BuildingValidationError("BUILDING_RING_TOO_SHORT", `${ringIndex + 1}-halqa kamida 4 nuqtadan iborat bo‘lishi kerak`);
    }
    const cleaned = ring.map((position, pointIndex) => cleanPosition(position, ringIndex, pointIndex));
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) cleaned.push([first[0], first[1]]);
    const unique = new Set(cleaned.slice(0, -1).map((p) => `${p[0]},${p[1]}`));
    if (unique.size < 3) throw new BuildingValidationError("BUILDING_RING_DEGENERATE", `${ringIndex + 1}-halqa buzuq (uch xil nuqta yo‘q)`);
    totalVertices += cleaned.length;
    return cleaned;
  });

  if (totalVertices > BUILDING_MAX_VERTICES) {
    throw new BuildingValidationError("BUILDING_GEOMETRY_TOO_LARGE", `Binoda ${BUILDING_MAX_VERTICES} tadan ortiq nuqta bo‘lishi mumkin emas`);
  }
  return { type: "Polygon", coordinates: rings };
}

export function polygonAreaSqm(geometry) {
  const ring = geometry.coordinates[0];
  const R = 6378137;
  const rad = Math.PI / 180;
  const latRef = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
  const cosLat = Math.cos(latRef * rad);
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    const x1 = lng1 * rad * R * cosLat;
    const y1 = lat1 * rad * R;
    const x2 = lng2 * rad * R * cosLat;
    const y2 = lat2 * rad * R;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

export function validateBuildingInput(input) {
  if (!input || typeof input !== "object") throw new BuildingValidationError("BUILDING_INPUT_INVALID", "Bino ma’lumotlari yuborilmadi");
  const geometry = validatePolygon(input.geometry);
  const area = polygonAreaSqm(geometry);
  if (area < BUILDING_MIN_AREA_SQM || area > BUILDING_MAX_AREA_SQM) {
    throw new BuildingValidationError("BUILDING_AREA_INVALID", "Bino maydoni haqiqiy emas", { areaSqm: Number(area.toFixed(2)), min: BUILDING_MIN_AREA_SQM, max: BUILDING_MAX_AREA_SQM });
  }
  const status = requireEnum(input.status ?? "draft", BUILDING_STATUSES, "status", "Holat");
  const result = {
    name: requireText(input.name ?? "", "Bino nomi", 180),
    buildingType: requireEnum(input.buildingType ?? "other", BUILDING_TYPES, "buildingType", "Bino turi"),
    material: requireEnum(input.material ?? "unknown", BUILDING_MATERIALS, "material", "Qurilish materiali"),
    levels: optionalLevels(input.levels), status,
    districtName: requireText(input.districtName ?? "", "Tuman", 120),
    neighborhoodName: requireText(input.neighborhoodName ?? "", "Mahalla", 120),
    source: requireEnum(input.source ?? "manual", BUILDING_SOURCES, "source", "Manba"),
    sourceConfidence: optionalConfidence(input.sourceConfidence),
    verified: Boolean(input.verified ?? false), areaSqm: Number(area.toFixed(2)), geometry,
  };
  if (input.expectedUpdatedAt !== undefined) {
    if (typeof input.expectedUpdatedAt !== "string" || Number.isNaN(Date.parse(input.expectedUpdatedAt))) throw new BuildingValidationError("BUILDING_VERSION_INVALID", "updatedAt qiymati noto‘g‘ri");
    result.expectedUpdatedAt = input.expectedUpdatedAt;
  }
  return result;
}

export function canPublishBuilding(building) {
  const machineSourced = building.source === "microsoft" || building.source === "osm";
  if (machineSourced && !building.verified) return { ok: false, message: "Mashina manbasidan kelgan bino nashrdan oldin tekshirilishi kerak" };
  return { ok: true };
}

export function isInsideSurxondaryo(geometry) {
  const bounds = { west: 66.1, south: 36.9, east: 68.7, north: 38.7 };
  return geometry.coordinates.every((ring) => ring.every(([lng, lat]) => (lng >= bounds.west && lng <= bounds.east && lat >= bounds.south && lat <= bounds.north)));
}

export function toFeatureCollection(buildings) {
  return { type: "FeatureCollection", features: buildings.map((building) => ({
    type: "Feature", id: building.id, geometry: building.geometry,
    properties: {
      id: building.id, name: building.name, buildingType: building.buildingType, material: building.material, levels: building.levels,
      status: building.status, districtName: building.districtName, neighborhoodName: building.neighborhoodName, source: building.source,
      sourceConfidence: building.sourceConfidence, verified: building.verified, areaSqm: building.areaSqm, createdAt: building.createdAt, updatedAt: building.updatedAt,
    },
  })) };
}
