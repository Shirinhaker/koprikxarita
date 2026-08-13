// Bino uslublari — road-style.mjs bilan bir xil naqshda, lekin Polygon uchun.
//
// Saqlangan binolar to‘ldirilgan poligon sifatida chiziladi. Rangi manba va
// holatga qarab farqlanadi, shunda tekshiruv oqimi ko‘zga ko‘rinadi:
//   - nashr qilingan   -> to‘q, ishonchli
//   - tekshirilgan draft-> ko‘k
//   - mashina (import)  -> sariq (diqqat: tekshirish kerak)
// Draft (chizilayotgan) poligon esa alohida, yorqin konturda ko‘rinadi.

export const BUILDING_PUBLISHED_FILL = "#7c8a99";
export const BUILDING_PUBLISHED_LINE = "#5a6675";
export const BUILDING_VERIFIED_FILL = "#4a90d9";
export const BUILDING_VERIFIED_LINE = "#2f6fb3";
export const BUILDING_MACHINE_FILL = "#e0b53a";
export const BUILDING_MACHINE_LINE = "#b8901f";
export const DRAFT_BUILDING_FILL = "#2f6fb3";
export const DRAFT_BUILDING_LINE = "#1c4e86";

// Manba/holatga qarab rang tanlash (data-driven).
const fillColorExpression = [
  "case",
  ["==", ["get", "status"], "published"], BUILDING_PUBLISHED_FILL,
  ["==", ["get", "verified"], true], BUILDING_VERIFIED_FILL,
  ["in", ["get", "source"], ["literal", ["microsoft", "osm"]]], BUILDING_MACHINE_FILL,
  BUILDING_VERIFIED_FILL,
];

const lineColorExpression = [
  "case",
  ["==", ["get", "status"], "published"], BUILDING_PUBLISHED_LINE,
  ["==", ["get", "verified"], true], BUILDING_VERIFIED_LINE,
  ["in", ["get", "source"], ["literal", ["microsoft", "osm"]]], BUILDING_MACHINE_LINE,
  BUILDING_VERIFIED_LINE,
];

const lineWidth = [
  "interpolate", ["linear"], ["zoom"], 13, 0.4, 16, 1.2, 18, 2, 20, 3,
];

const zoomOpacity = [
  "interpolate", ["linear"], ["zoom"], 12, 0, 13, 0.55, 15, 0.75,
];

export function createSavedBuildingLayers({ source = "buildings-source" } = {}) {
  return [
    {
      id: "buildings-fill",
      type: "fill",
      source,
      minzoom: 12,
      paint: {
        "fill-color": fillColorExpression,
        "fill-opacity": zoomOpacity,
      },
    },
    {
      id: "buildings-outline",
      type: "line",
      source,
      minzoom: 13,
      layout: { "line-join": "round" },
      paint: {
        "line-color": lineColorExpression,
        "line-width": lineWidth,
      },
    },
  ];
}

export function createDraftBuildingLayers({ source = "draft-building-source" } = {}) {
  return [
    {
      id: "draft-building-fill",
      type: "fill",
      source,
      minzoom: 12,
      filter: ["==", ["get", "kind"], "polygon"],
      paint: {
        "fill-color": DRAFT_BUILDING_FILL,
        "fill-opacity": 0.25,
      },
    },
    {
      id: "draft-building-outline",
      type: "line",
      source,
      minzoom: 12,
      filter: ["==", ["get", "kind"], "polygon"],
      layout: { "line-join": "round" },
      paint: {
        "line-color": DRAFT_BUILDING_LINE,
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 18, 2.5],
      },
    },
    {
      id: "draft-building-points",
      type: "circle",
      source,
      minzoom: 12,
      filter: ["==", ["get", "kind"], "point"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3, 18, 5],
        "circle-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-stroke-color": DRAFT_BUILDING_LINE,
      },
    },
  ];
}
