// Hudud uslublari — viloyat, tuman va mahalla chegaralari.
//
// Nomlar bu yerda emas, HTML belgi (Marker) sifatida chiziladi:
// xarita uslubida `glyphs` manzili yo'q, shuning uchun MapLibre'ning
// symbol qatlami matnni ko'rsata olmaydi va tashqi shrift serveriga
// bog'lanib qolishni istamaymiz.
//
// Rang viloyatga tegishli: har viloyat o'z rangiga ega, uning tumanlari
// esa shu rangni meros qiladi. Shuning uchun chiziq rangi har doim
// colorIndex xossasidan olinadi (region-palette.mjs ga qarang), qaysi
// darajada bo'lishidan qat'i nazar.
//
// Daraja rangni emas, og'irlikni belgilaydi:
//   viloyat — qalin uzun uzuq chiziq, to'ldirish sezilarli
//   tuman   — ingichkaroq, maydaroq uzuq
//   mahalla — eng ingichka, deyarli uzluksiz

import { colorByProvinceExpression } from "./region-palette.mjs";

const isViloyat = ["==", ["get", "level"], "viloyat"];
const isTuman = ["==", ["get", "level"], "tuman"];

// Daraja bo'yicha uch xil qiymatdan birini tanlaydi.
const byLevel = (viloyat, tuman, mahalla) => [
  "case", isViloyat, viloyat, isTuman, tuman, mahalla,
];

const lineWidth = [
  "interpolate", ["linear"], ["zoom"],
  5, byLevel(1.4, 0, 0),
  7, byLevel(2.0, 0.5, 0),
  9, byLevel(2.6, 1.1, 0),
  12, byLevel(3.0, 1.8, 0.8),
  16, byLevel(3.4, 2.4, 1.6),
];

// Yaqinlashganda viloyat chizig'i xiralashadi — tuman chizig'i ustun
// bo'lishi kerak, aks holda ikkalasi bir-birini bosadi.
const lineOpacity = [
  "interpolate", ["linear"], ["zoom"],
  5, byLevel(0.9, 0, 0),
  8, byLevel(0.85, 0.55, 0),
  11, byLevel(0.7, 0.8, 0.5),
  16, byLevel(0.45, 0.6, 0.8),
];

// To'ldirish har doim juda xira: u viloyatni ajratish uchun, yo'l va
// binoni bekitish uchun emas.
const fillOpacity = [
  "interpolate", ["linear"], ["zoom"],
  5, byLevel(0.16, 0, 0),
  9, byLevel(0.12, 0.05, 0),
  13, byLevel(0.05, 0.05, 0.04),
  16, byLevel(0.03, 0.03, 0.04),
];

const dash = [
  "case",
  isViloyat, ["literal", [4, 1.8]],
  isTuman, ["literal", [2.4, 1.4]],
  ["literal", [1.4, 1]],
];

export function createRegionLayers({ source = "regions-source" } = {}) {
  const color = colorByProvinceExpression();
  return [
    {
      id: "regions-fill",
      type: "fill",
      source,
      paint: {
        "fill-color": color,
        "fill-opacity": fillOpacity,
      },
    },
    {
      id: "regions-line",
      type: "line",
      source,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": color,
        "line-width": lineWidth,
        "line-opacity": lineOpacity,
        "line-dasharray": dash,
      },
    },
  ];
}

// ---- O'zbekistondan tashqarisini yopadigan niqob ----
//
// Xaritada faqat O'zbekiston ko'rinishi kerak. Fon xaritasi (OSM) butun
// dunyoni beradi, shuning uchun uning ustiga "teshikli" poligon
// qo'yiladi: tashqi halqa — butun dunyo, ichki halqalar — O'zbekiston
// chegarasi. Poligon qoidasi bo'yicha ichki halqa teshik bo'ladi,
// ya'ni mamlakat ochiq qoladi, qolgani yopiladi.

export const MASK_COLOR = "#eceae6";

const WORLD_RING = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];

export function createMaskFeature(countryGeometry) {
  const holes = [];
  if (countryGeometry) {
    const polygons = countryGeometry.type === "MultiPolygon"
      ? countryGeometry.coordinates
      : [countryGeometry.coordinates];
    // Faqat tashqi halqalar teshik bo'ladi. Mamlakat ichidagi teshiklar
    // (agar bo'lsa) niqobda hisobga olinmaydi — ular baribir yopiq.
    for (const rings of polygons) holes.push(rings[0]);
  }
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [WORLD_RING, ...holes] },
  };
}

export function createMaskLayers({ source = "country-mask-source" } = {}) {
  return [
    {
      id: "country-mask-fill",
      type: "fill",
      source,
      paint: {
        "fill-color": MASK_COLOR,
        // To'liq yopmaydi: qo'shni davlatlar biroz sezilib tursin,
        // xarita "kesilgan" emas, "diqqat markazida" ko'rinsin.
        "fill-opacity": 0.94,
      },
    },
    {
      id: "country-mask-line",
      type: "line",
      source,
      layout: { "line-join": "round" },
      paint: {
        "line-color": "#6b625a",
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.2, 8, 2, 12, 2.6],
        "line-opacity": 0.75,
      },
    },
  ];
}
