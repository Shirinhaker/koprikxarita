// Esri World Imagery — "proyektor" qatlami.
// OSM asosi ustida, binolar ostida turadi. Unga chizilmaydi (faqat ko‘rsatadi).
// Shaffofligi (opacity) real vaqtda boshqariladi: 0 = ko‘rinmas, 1 = to‘liq.
//
// HUQUQIY: Esri tasviri manba emas, faqat tekshiruv/orientir uchun. Ko‘rsatilganda
// attribution majburiy. Undan chizib olingan yangi bino tijoratda ishlatilishidan
// oldin ODbL manbasiga (OSM) o‘tkazilishi kerak — bu qatlam faqat vizual yordamchi.

export const ESRI_WORLD_IMAGERY_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export const ESRI_ATTRIBUTION =
  "Tasvir: &copy; Esri, Maxar, Earthstar Geographics va GIS jamoasi";

export const ESRI_SOURCE_ID = "esri-imagery";
export const ESRI_LAYER_ID = "esri-imagery-raster";
export const DEFAULT_ESRI_OPACITY = 0.35;

function clampOpacity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_ESRI_OPACITY;
  return Math.min(1, Math.max(0, n));
}

// MapLibre uchun raster manba tavsifi (style.sources ga qo‘shiladi).
export function createEsriSource({ tileUrl = ESRI_WORLD_IMAGERY_URL, attribution = ESRI_ATTRIBUTION } = {}) {
  if (typeof tileUrl !== "string" || !tileUrl.includes("{z}") || !tileUrl.includes("{x}") || !tileUrl.includes("{y}")) {
    throw new TypeError("Esri tile manzili {z}, {x} va {y} qismlarini o‘z ichiga olishi kerak");
  }
  return {
    type: "raster",
    tiles: [tileUrl],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 19,
    attribution,
  };
}

// Raster qatlam. Standart holatda xira (proyektor kabi).
export function createEsriLayer({ opacity = DEFAULT_ESRI_OPACITY, source = ESRI_SOURCE_ID } = {}) {
  return {
    id: ESRI_LAYER_ID,
    type: "raster",
    source,
    minzoom: 0,
    maxzoom: 22,
    paint: {
      "raster-opacity": clampOpacity(opacity),
      "raster-fade-duration": 0,
    },
  };
}

// Xaritaga proyektorni ulash. Bino qatlamlari OSM asosidan keyin, Esri esa
// ular orasida — OSM ustida, binolar ostida turishi uchun beforeId beriladi.
export function attachEsriProjector(map, { opacity = DEFAULT_ESRI_OPACITY, beforeId = undefined, ...sourceOptions } = {}) {
  if (!map.getSource(ESRI_SOURCE_ID)) {
    map.addSource(ESRI_SOURCE_ID, createEsriSource(sourceOptions));
  }
  if (!map.getLayer(ESRI_LAYER_ID)) {
    map.addLayer(createEsriLayer({ opacity }), beforeId);
  }
}

// Slider bilan boshqarish — real vaqtda shaffoflikni o‘zgartiradi.
export function setEsriOpacity(map, value) {
  if (!map.getLayer(ESRI_LAYER_ID)) return;
  map.setPaintProperty(ESRI_LAYER_ID, "raster-opacity", clampOpacity(value));
}

// Proyektorni butunlay yoqish/o‘chirish (ko‘rinishni almashtirish).
export function setEsriVisible(map, visible) {
  if (!map.getLayer(ESRI_LAYER_ID)) return;
  map.setLayoutProperty(ESRI_LAYER_ID, "visibility", visible ? "visible" : "none");
}
