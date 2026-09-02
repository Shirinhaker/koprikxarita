// Hudud uslublari — tuman va mahalla chegaralari.
//
// Nomlar bu yerda emas, HTML belgi (Marker) sifatida chiziladi:
// xarita uslubida `glyphs` manzili yo'q, shuning uchun MapLibre'ning
// symbol qatlami matnni ko'rsata olmaydi va tashqi shrift serveriga
// bog'lanib qolishni istamaymiz.
//
// Chegara fon ma'lumoti: u yo'l va binoni bekitmasligi kerak. Shuning uchun
// to'ldirish juda xira, asosiy og'irlik chiziqda. Tuman qalinroq va uzuq
// chiziq bilan (rasmiy chegara an'anasi), mahalla ingichkaroq.
//
// Ranglar yo'l (oq-kulrang) va binodan (kulrang/ko'k/sariq) ataylab uzoq
// tanlangan — binafsha-siyoh tusi xaritada boshqa hech narsa bilan
// chalkashmaydi.

export const TUMAN_LINE = "#6b4fa8";
export const TUMAN_FILL = "#6b4fa8";
export const MAHALLA_LINE = "#c2704f";
export const MAHALLA_FILL = "#c2704f";
export const REGION_LABEL_COLOR = "#3f2f66";
export const REGION_LABEL_HALO = "#ffffff";

const isTuman = ["==", ["get", "level"], "tuman"];

// Uzoq masshtabda tuman chegarasi ko'rinadi; yaqinlashganda mahalla
// qo'shiladi va tuman biroz xiralashadi — ustma-ust tushib, ko'zni
// charchatmasligi uchun.
const lineColor = ["case", isTuman, TUMAN_LINE, MAHALLA_LINE];

const lineWidth = [
  "interpolate", ["linear"], ["zoom"],
  7, ["case", isTuman, 1.1, 0.4],
  10, ["case", isTuman, 1.8, 0.8],
  13, ["case", isTuman, 2.6, 1.4],
  16, ["case", isTuman, 3.2, 2],
];

const lineOpacity = [
  "interpolate", ["linear"], ["zoom"],
  7, ["case", isTuman, 0.85, 0],
  12, ["case", isTuman, 0.8, 0.7],
  16, ["case", isTuman, 0.55, 0.8],
];

const fillOpacity = [
  "interpolate", ["linear"], ["zoom"],
  7, ["case", isTuman, 0.09, 0],
  12, ["case", isTuman, 0.06, 0.05],
  16, ["case", isTuman, 0.03, 0.04],
];

export function createRegionLayers({ source = "regions-source" } = {}) {
  return [
    {
      id: "regions-fill",
      type: "fill",
      source,
      paint: {
        "fill-color": ["case", isTuman, TUMAN_FILL, MAHALLA_FILL],
        "fill-opacity": fillOpacity,
      },
    },
    {
      id: "regions-line",
      type: "line",
      source,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": lineColor,
        "line-width": lineWidth,
        "line-opacity": lineOpacity,
        // Uzuq chiziq — rasmiy ma'muriy chegara belgisi. Mahalla uchun
        // ancha maydaroq, tumandan ajralib tursin.
        "line-dasharray": ["case", isTuman, ["literal", [3, 1.6]], ["literal", [1.6, 1.2]]],
      },
    },
  ];
}
