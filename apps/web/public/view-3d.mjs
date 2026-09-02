// 3D ko'rinish — xaritani qiyalatish va binolarni hajmli chizish.
//
// Ikki narsadan iborat:
//   1. Kamera qiyaligi (pitch) — tekis ko'rinishdan qiya ko'rinishga
//   2. Bino ekstruziyasi — poligon o'rniga hajmli quti
//
// Balandlik binoning o'z ma'lumotidan olinadi: qavatlar soni × 3 metr.
// Qavati kiritilmagan bino uchun turiga qarab taxminiy balandlik
// beriladi — hech narsa ko'rsatmaslikdan ko'ra taxmin afzal, lekin
// bu taxmin ekani foydalanuvchiga aytiladi.
//
// Fon xaritasi raster (OSM rasm plitkalari), shuning uchun u qiyalatilganda
// ham tekis yotadi — bu normal. Relyef (tog') 3D emas; buning uchun
// alohida balandlik ma'lumoti kerak bo'lardi.

import { colorByProvinceExpression } from "./region-palette.mjs";

const PITCH_3D = 55;
const PITCH_FLAT = 0;
const METERS_PER_LEVEL = 3;

// Qavati noma'lum bino uchun turiga qarab taxminiy balandlik (metr).
const FALLBACK_HEIGHT = {
  residential: 6,
  commercial: 8,
  industrial: 9,
  public: 10,
  religious: 12,
  education: 9,
  health: 12,
  other: 6,
};

// Balandlik ifodasi: avval qavat, bo'lmasa turiga qarab taxmin.
const heightExpression = [
  "case",
  [">", ["coalesce", ["get", "levels"], 0], 0],
  ["*", ["get", "levels"], METERS_PER_LEVEL],
  [
    "match", ["get", "buildingType"],
    ...Object.entries(FALLBACK_HEIGHT).flatMap(([type, height]) => [type, height]),
    FALLBACK_HEIGHT.other,
  ],
];

export function createBuildingExtrusionLayer({ source = "buildings-source" } = {}) {
  return {
    id: "buildings-3d",
    type: "fill-extrusion",
    source,
    minzoom: 14,
    layout: { visibility: "none" },
    paint: {
      // Rang tekis ko'rinishdagi bino rangiga yaqin qoldirildi —
      // 3D ga o'tganda foydalanuvchi "boshqa xarita"ga tushib
      // qolgandek his qilmasligi kerak.
      "fill-extrusion-color": [
        "case",
        ["==", ["get", "status"], "published"], "#9aa5b1",
        ["==", ["get", "verified"], true], "#7aa8dd",
        ["in", ["get", "source"], ["literal", ["microsoft", "osm"]]], "#e3c268",
        "#7aa8dd",
      ],
      "fill-extrusion-height": heightExpression,
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": 0.85,
      // Yaqinlashganda paydo bo'lsin — uzoqdan hajm faqat shovqin.
      "fill-extrusion-vertical-gradient": true,
    },
  };
}

export function initView3d(map, ctx) {
  const { toast } = ctx ?? {};
  const button = document.querySelector("#view3dButton");
  let on = false;
  let layerAdded = false;

  // Bino manbasi buildings-app.mjs tomonidan yaratiladi, shuning uchun
  // ekstruziya qatlami u tayyor bo'lgandan keyin qo'shiladi.
  function ensureLayer() {
    if (layerAdded) return true;
    if (!map.getSource("buildings-source")) return false;
    map.addLayer(createBuildingExtrusionLayer());
    layerAdded = true;
    return true;
  }

  function setExtrusionVisible(visible) {
    if (!ensureLayer()) return;
    map.setLayoutProperty("buildings-3d", "visibility", visible ? "visible" : "none");
    // Tekis bino qatlami hajmli qatlam bilan ustma-ust tushmasligi kerak.
    if (map.getLayer("buildings-fill")) {
      map.setLayoutProperty("buildings-fill", "visibility", visible ? "none" : "visible");
    }
  }

  function apply(next) {
    on = next;
    setExtrusionVisible(on);
    map.easeTo({ pitch: on ? PITCH_3D : PITCH_FLAT, duration: 600 });
    button?.classList.toggle("active", on);
    button?.setAttribute("aria-pressed", String(on));
    if (button) {
      button.title = on ? "Tekis ko‘rinishga qaytish" : "3D ko‘rinish";
      button.setAttribute("aria-label", button.title);
    }

    if (on && map.getZoom() < 14) {
      toast?.("3D binolar 14-darajadan yaqinlashganda ko‘rinadi", "info");
    }
  }

  button?.addEventListener("click", () => apply(!on));

  // Foydalanuvchi sichqoncha bilan qiyalatsa, tugma holati ham
  // haqiqatga mos bo'lishi kerak.
  map.on("pitchend", () => {
    const tilted = map.getPitch() > 5;
    if (tilted === on) return;
    on = tilted;
    setExtrusionVisible(on);
    button?.classList.toggle("active", on);
    button?.setAttribute("aria-pressed", String(on));
  });

  return {
    isOn: () => on,
    set: apply,
    toggle: () => apply(!on),
  };
}
