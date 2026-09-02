import { SURXONDARYO_BOUNDS } from "./surxondaryo.mjs";

// Hudud domeni — tuman va mahalla chegaralari.
//
// Binolardan (buildings.mjs) farqi: hudud MultiPolygon bo‘lishi mumkin
// (anklav, ajralgan qism) va halqalarda nuqta ancha ko‘p bo‘ladi.
// Yo‘l va binodan farqli o‘laroq hudud odam tomonidan emas, rasmiy
// manbadan (OSM) keladi — shuning uchun nashr uchun tekshiruv talab
// qilinmaydi, lekin manba har doim saqlanadi.
//
// Mahalla hozircha OSM'da yo‘q (Surxondaryo bo‘yicha atigi 3 ta),
// shuning uchun u qo‘lda chiziladi. Tuzilma ikkalasini ham qo‘llaydi.

export const REGION_LEVELS = ["tuman", "mahalla"];
export const REGION_STATUSES = ["draft", "published", "archived"];
export const REGION_SOURCES = ["osm", "manual", "other"];

export const REGION_MAX_VERTICES = 60_000;

export class RegionValidationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "RegionValidationError";
    this.code = code;
    this.details = details;
  }
}

function requireEnum(value, allowed, field, label) {
  if (!allowed.includes(value)) {
    throw new RegionValidationError("REGION_FIELD_INVALID", `${label} noto‘g‘ri`, { field, allowed });
  }
  return value;
}

function requireText(value, field, maxLength, { required = false } = {}) {
  if (typeof value !== "string") {
    throw new RegionValidationError("REGION_FIELD_INVALID", `${field} matn bo‘lishi kerak`, { field });
  }
  const text = value.trim();
  if (required && text.length === 0) {
    throw new RegionValidationError("REGION_FIELD_REQUIRED", `${field} bo‘sh bo‘lishi mumkin emas`, { field });
  }
  if (text.length > maxLength) {
    throw new RegionValidationError("REGION_FIELD_TOO_LONG", `${field} juda uzun`, { field, maxLength });
  }
  return text;
}

function optionalId(value, field) {
  if (value === undefined || value === null || value === "") return null;
  return requireText(String(value), field, 120);
}

function cleanPosition(position, where) {
  if (!Array.isArray(position) || position.length < 2) {
    throw new RegionValidationError("REGION_POSITION_INVALID", `${where} noto‘g‘ri nuqta`);
  }
  const lng = Number(position[0]);
  const lat = Number(position[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    throw new RegionValidationError("REGION_POSITION_INVALID", `${where} koordinatasi noto‘g‘ri`);
  }
  return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
}

function validateRing(ring, where) {
  if (!Array.isArray(ring) || ring.length < 4) {
    throw new RegionValidationError("REGION_RING_TOO_SHORT", `${where} kamida 4 nuqtadan iborat bo‘lishi kerak`);
  }
  const cleaned = ring.map((position, index) => cleanPosition(position, `${where}, ${index + 1}-nuqta`));

  // Halqa yopiq bo‘lishi shart.
  const first = cleaned[0];
  const last = cleaned[cleaned.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) cleaned.push([first[0], first[1]]);

  const unique = new Set(cleaned.slice(0, -1).map((point) => `${point[0]},${point[1]}`));
  if (unique.size < 3) {
    throw new RegionValidationError("REGION_RING_DEGENERATE", `${where} buzuq (uch xil nuqta yo‘q)`);
  }
  return cleaned;
}

// Polygon ham, MultiPolygon ham qabul qilinadi. Ichkarida ikkalasi bir xil
// shaklda — polygons[] massivi sifatida — saqlanadi, keyin qaytariladi.
export function validateRegionGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") {
    throw new RegionValidationError("REGION_GEOMETRY_INVALID", "Geometriya yuborilmadi");
  }
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
    throw new RegionValidationError("REGION_GEOMETRY_INVALID", "Geometriya Polygon yoki MultiPolygon bo‘lishi kerak");
  }

  const rawPolygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(rawPolygons) || rawPolygons.length === 0) {
    throw new RegionValidationError("REGION_GEOMETRY_INVALID", "Hududda kamida bitta poligon bo‘lishi kerak");
  }

  let vertices = 0;
  const polygons = rawPolygons.map((rings, polygonIndex) => {
    if (!Array.isArray(rings) || rings.length === 0) {
      throw new RegionValidationError("REGION_GEOMETRY_INVALID", `${polygonIndex + 1}-poligonda halqa yo‘q`);
    }
    return rings.map((ring, ringIndex) => {
      const cleaned = validateRing(ring, `${polygonIndex + 1}-poligon, ${ringIndex + 1}-halqa`);
      vertices += cleaned.length;
      return cleaned;
    });
  });

  if (vertices > REGION_MAX_VERTICES) {
    throw new RegionValidationError("REGION_GEOMETRY_TOO_LARGE", `Hududda ${REGION_MAX_VERTICES} tadan ortiq nuqta bo‘lishi mumkin emas`, { vertices });
  }

  return polygons.length === 1
    ? { type: "Polygon", coordinates: polygons[0] }
    : { type: "MultiPolygon", coordinates: polygons };
}

export function validateRegionInput(input) {
  if (!input || typeof input !== "object") {
    throw new RegionValidationError("REGION_INPUT_INVALID", "Hudud ma’lumotlari yuborilmadi");
  }

  const level = requireEnum(input.level ?? "tuman", REGION_LEVELS, "level", "Hudud darajasi");
  const result = {
    name: requireText(input.name ?? "", "Hudud nomi", 180, { required: true }),
    level,
    parentId: optionalId(input.parentId, "Yuqori hudud"),
    code: requireText(input.code ?? "", "Kod", 60),
    source: requireEnum(input.source ?? "manual", REGION_SOURCES, "source", "Manba"),
    sourceId: optionalId(input.sourceId, "Manba identifikatori"),
    status: requireEnum(input.status ?? "draft", REGION_STATUSES, "status", "Holat"),
    geometry: validateRegionGeometry(input.geometry),
  };

  // Mahalla har doim biror tumanga tegishli bo‘lishi kerak — aks holda
  // qidiruv va hisobotlarda "egasiz" qolib ketadi.
  if (level === "mahalla" && !result.parentId) {
    throw new RegionValidationError("REGION_PARENT_REQUIRED", "Mahalla qaysi tumanga tegishli ekani ko‘rsatilishi kerak", { field: "parentId" });
  }
  if (level === "tuman" && result.parentId) {
    throw new RegionValidationError("REGION_PARENT_INVALID", "Tuman uchun yuqori hudud ko‘rsatilmaydi", { field: "parentId" });
  }

  if (input.expectedUpdatedAt !== undefined) {
    if (typeof input.expectedUpdatedAt !== "string" || Number.isNaN(Date.parse(input.expectedUpdatedAt))) {
      throw new RegionValidationError("REGION_VERSION_INVALID", "updatedAt qiymati noto‘g‘ri");
    }
    result.expectedUpdatedAt = input.expectedUpdatedAt;
  }

  return result;
}

// Hudud nashrga tayyormi. Bino bilan farqi shu yerda: rasmiy chegara
// mashina taxmini emas, shuning uchun qo‘shimcha tekshiruv talab qilinmaydi.
export function canPublishRegion(region) {
  if (!region.name?.trim()) {
    return { ok: false, message: "Nomsiz hududni nashr qilib bo‘lmaydi" };
  }
  return { ok: true };
}

function eachPolygon(geometry) {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

export function regionBounds(geometry) {
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const rings of eachPolygon(geometry)) {
    for (const [lng, lat] of rings[0]) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return { west, south, east, north };
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Nuqta hudud ichidami. Teshiklar (ichki halqalar) hisobga olinadi.
export function isPointInRegion(point, geometry) {
  for (const rings of eachPolygon(geometry)) {
    if (!pointInRing(point, rings[0])) continue;
    const inHole = rings.slice(1).some((hole) => pointInRing(point, hole));
    if (!inHole) return true;
  }
  return false;
}

// Nuqta qaysi hududga tushishini topadi. Mahalla tumandan ustun turadi —
// aniqroq hudud avval qaytariladi.
export function findRegionAtPoint(point, regions) {
  const ordered = [...regions].sort((a, b) => REGION_LEVELS.indexOf(b.level) - REGION_LEVELS.indexOf(a.level));
  return ordered.find((region) => isPointInRegion(point, region.geometry)) ?? null;
}

export function isInsideSurxondaryo(geometry) {
  const limits = SURXONDARYO_BOUNDS;
  const bounds = regionBounds(geometry);
  return bounds.west >= limits.west && bounds.east <= limits.east
    && bounds.south >= limits.south && bounds.north <= limits.north;
}

export function toFeatureCollection(regions) {
  return {
    type: "FeatureCollection",
    features: regions.map((region) => ({
      type: "Feature",
      id: region.id,
      geometry: region.geometry,
      properties: {
        id: region.id,
        name: region.name,
        level: region.level,
        parentId: region.parentId,
        code: region.code,
        source: region.source,
        status: region.status,
        createdAt: region.createdAt,
        updatedAt: region.updatedAt,
      },
    })),
  };
}

// Hudud nomini xaritada yozish uchun markaziy nuqta. Eng katta poligonning
// o‘rtacha nuqtasi olinadi — teshikli yoki ilon izi shaklda ham matn
// hudud ichida qoladi.
export function regionLabelPoint(geometry) {
  const polygons = eachPolygon(geometry);
  let widest = polygons[0][0];
  let widestSpan = -1;
  for (const rings of polygons) {
    const ring = rings[0];
    let west = Infinity; let east = -Infinity;
    for (const [lng] of ring) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
    }
    if (east - west > widestSpan) {
      widestSpan = east - west;
      widest = ring;
    }
  }
  const points = widest.length > 1 ? widest.slice(0, -1) : widest;
  const sum = points.reduce((acc, [lng, lat]) => [acc[0] + lng, acc[1] + lat], [0, 0]);
  return [Number((sum[0] / points.length).toFixed(6)), Number((sum[1] / points.length).toFixed(6))];
}

export function toLabelFeatureCollection(regions) {
  return {
    type: "FeatureCollection",
    features: regions.map((region) => ({
      type: "Feature",
      id: `${region.id}-label`,
      geometry: { type: "Point", coordinates: regionLabelPoint(region.geometry) },
      properties: { id: region.id, name: region.name, level: region.level },
    })),
  };
}
