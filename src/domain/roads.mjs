export const ROAD_TYPES = ["residential", "service", "pedestrian", "track", "other"];
export const ROAD_SURFACES = ["asphalt", "concrete", "gravel", "ground", "unknown"];
export const ROAD_DIRECTIONS = ["two_way", "one_way"];
export const ROAD_STATUSES = ["draft", "published", "archived"];

export class RoadValidationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "RoadValidationError";
    this.code = code;
    this.details = details;
  }
}

function requireEnum(value, allowed, field, label) {
  if (!allowed.includes(value)) {
    throw new RoadValidationError("ROAD_FIELD_INVALID", `${label} noto‘g‘ri`, { field, allowed });
  }
  return value;
}

function requireText(value, field, maxLength) {
  if (typeof value !== "string") {
    throw new RoadValidationError("ROAD_FIELD_INVALID", `${field} matn bo‘lishi kerak`, { field });
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw new RoadValidationError("ROAD_FIELD_TOO_LONG", `${field} juda uzun`, { field, maxLength });
  }
  return text;
}

function validateCoordinates(geometry) {
  if (!geometry || geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    throw new RoadValidationError("ROAD_GEOMETRY_INVALID", "Geometriya LineString bo‘lishi kerak");
  }
  if (geometry.coordinates.length < 2) {
    throw new RoadValidationError("ROAD_GEOMETRY_TOO_SHORT", "Ko‘cha kamida ikki nuqtadan iborat bo‘lishi kerak");
  }
  if (geometry.coordinates.length > 5000) {
    throw new RoadValidationError("ROAD_GEOMETRY_TOO_LARGE", "Ko‘chada 5000 tadan ortiq nuqta bo‘lishi mumkin emas");
  }

  const coordinates = geometry.coordinates.map((position, index) => {
    if (!Array.isArray(position) || position.length < 2) {
      throw new RoadValidationError("ROAD_POSITION_INVALID", `${index + 1}-nuqta noto‘g‘ri`);
    }
    const lng = Number(position[0]);
    const lat = Number(position[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      throw new RoadValidationError("ROAD_POSITION_INVALID", `${index + 1}-nuqta koordinatasi noto‘g‘ri`);
    }
    return [Number(lng.toFixed(7)), Number(lat.toFixed(7))];
  });

  return { type: "LineString", coordinates };
}

export function validateRoadInput(input) {
  if (!input || typeof input !== "object") {
    throw new RoadValidationError("ROAD_INPUT_INVALID", "Ko‘cha ma’lumotlari yuborilmadi");
  }

  const status = requireEnum(input.status ?? "draft", ROAD_STATUSES, "status", "Holat");
  const result = {
    name: requireText(input.name ?? "", "Ko‘cha nomi", 180),
    roadType: requireEnum(input.roadType, ROAD_TYPES, "roadType", "Yo‘l turi"),
    surface: requireEnum(input.surface, ROAD_SURFACES, "surface", "Yo‘l qoplamasi"),
    direction: requireEnum(input.direction, ROAD_DIRECTIONS, "direction", "Harakat yo‘nalishi"),
    status,
    districtName: requireText(input.districtName ?? "", "Tuman", 120),
    neighborhoodName: requireText(input.neighborhoodName ?? "", "Mahalla", 120),
    geometry: validateCoordinates(input.geometry),
  };

  if (input.expectedUpdatedAt !== undefined) {
    if (typeof input.expectedUpdatedAt !== "string" || Number.isNaN(Date.parse(input.expectedUpdatedAt))) {
      throw new RoadValidationError("ROAD_VERSION_INVALID", "updatedAt qiymati noto‘g‘ri");
    }
    result.expectedUpdatedAt = input.expectedUpdatedAt;
  }

  return result;
}

export function canPublishRoad(road) {
  if (!road?.name?.trim()) {
    return { ok: false, message: "Nashr qilish uchun ko‘cha nomi kerak" };
  }
  return { ok: true };
}

export function isInsideSurxondaryo(geometry) {
  const bounds = { west: 66.1, south: 36.9, east: 68.7, north: 38.7 };
  return geometry.coordinates.every(([lng, lat]) => (
    lng >= bounds.west && lng <= bounds.east && lat >= bounds.south && lat <= bounds.north
  ));
}

export function toFeatureCollection(roads) {
  return {
    type: "FeatureCollection",
    features: roads.map((road) => ({
      type: "Feature",
      id: road.id,
      geometry: road.geometry,
      properties: {
        id: road.id,
        name: road.name,
        roadType: road.roadType,
        surface: road.surface,
        direction: road.direction,
        status: road.status,
        districtName: road.districtName,
        neighborhoodName: road.neighborhoodName,
        createdAt: road.createdAt,
        updatedAt: road.updatedAt,
      },
    })),
  };
}
