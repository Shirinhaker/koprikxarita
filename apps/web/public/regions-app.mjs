// Hudud qatlami — davlat niqobi, viloyat va tuman chegaralari.
//
// buildings-app.mjs bilan bir xil naqsh: app.js undan initRegions() ni
// chaqiradi va xarita obyektini beradi. Hech qanday global funksiya
// almashtirilmaydi.
//
// Yuklash strategiyasi. Butun mamlakatning 206 ta tumani ~1.7 MB —
// uni sahifa ochilishida yuklab bo'lmaydi. Shuning uchun:
//   davlat  — bir marta, niqob uchun
//   viloyat — bir marta (14 ta, qattiq soddalashtirilgan)
//   tuman   — faqat TUMAN_ZOOM dan yaqinlashganda va faqat ko'rinayotgan
//             hudud uchun (bbox parametri bilan)
//
// Qatlamlar yo'l va bino ostiga qo'yiladi (beforeId) — chegara fon
// ma'lumoti, u asosiy mazmunni bekitmasligi kerak.

import { createMaskFeature, createMaskLayers, createRegionLayers } from "./region-style.mjs";
import { provinceColor } from "./region-palette.mjs";

const emptyFC = () => ({ type: "FeatureCollection", features: [] });

// Shu zoomdan boshlab tumanlar yuklanadi. Undan uzoqda viloyat yetarli
// va tuman chizig'i baribir ko'rinmaydi (region-style.mjs da eni 0).
const TUMAN_ZOOM = 8;

// Xarita surilgandan keyin shuncha kutiladi — har piksel siljishda
// so'rov yubormaslik uchun.
const MOVE_DEBOUNCE_MS = 350;

const levelLabels = { davlat: "Davlat", viloyat: "Viloyat", tuman: "Tuman", mahalla: "Mahalla" };

export function initRegions(map, ctx) {
  const { maplibre, api, beforeId } = ctx;
  const dom = collectDom();

  let viloyatlar = [];
  let tumanlar = [];
  let labelMarkers = [];
  let popup = null;
  let visible = true;
  let moveTimer = null;
  let lastTumanKey = "";
  let loadToken = 0;

  // ---- Qatlamlar ----
  // Tartib: niqob eng pastda (fon xaritasi ustida), keyin hududlar.
  map.addSource("country-mask-source", { type: "geojson", data: emptyFC() });
  addBelow(createMaskLayers());

  map.addSource("regions-source", { type: "geojson", data: emptyFC() });
  addBelow(createRegionLayers());

  function addBelow(layers) {
    for (const layer of layers) {
      if (beforeId && map.getLayer(beforeId)) map.addLayer(layer, beforeId);
      else map.addLayer(layer);
    }
  }

  // ---- Bosish ----
  map.on("click", "regions-fill", (event) => {
    if (!visible || window.__buildingDrawing) return;
    const properties = event.features?.[0]?.properties;
    if (!properties) return;
    // Yo'l va bino ustun — ular bosilganda hudud javob bermaydi.
    const above = map.queryRenderedFeatures(event.point, {
      layers: ["roads-fill", "buildings-fill"].filter((id) => map.getLayer(id)),
    });
    if (above.length > 0) return;
    showPopup(properties, event.lngLat);
  });

  function showPopup(properties, lngLat) {
    popup?.remove();
    const parent = viloyatlar.find((region) => region.id === properties.parentId);
    const color = provinceColor(Number(properties.colorIndex));
    const lines = [
      `<strong>${escapeHtml(properties.name)}</strong>`,
      `<span>${levelLabels[properties.level] ?? properties.level}</span>`,
    ];
    if (parent) lines.push(`<span>${escapeHtml(parent.name)} tarkibida</span>`);
    popup = new maplibre.Popup({ closeButton: true, className: "region-popup" })
      .setLngLat(lngLat)
      .setHTML(`<div class="region-popup-body" style="border-left:3px solid ${color};padding-left:8px">${lines.join("")}</div>`)
      .addTo(map);
  }

  // ---- Nomlar ----
  // MapLibre symbol qatlami o'rniga HTML belgi: xarita uslubida glyphs
  // manzili yo'q. Faqat hozir kerak bo'ladigan darajaning nomlari
  // chiziladi, aks holda yaqinlashganda yuzlab belgi paydo bo'lardi.
  function renderLabels() {
    for (const marker of labelMarkers) marker.remove();
    labelMarkers = [];
    if (!visible) return;

    const zoom = map.getZoom();
    const shown = zoom >= TUMAN_ZOOM + 1 ? tumanlar : viloyatlar;
    for (const region of shown) {
      if (!region.labelPoint) continue;
      const element = document.createElement("span");
      element.className = `region-label region-label-${region.level}`;
      element.textContent = region.name;
      element.style.color = provinceColor(region.colorIndex);
      labelMarkers.push(
        new maplibre.Marker({ element, anchor: "center" }).setLngLat(region.labelPoint).addTo(map),
      );
    }
  }

  function setVisible(next) {
    visible = next;
    const layers = ["country-mask-fill", "country-mask-line", "regions-fill", "regions-line"];
    for (const id of layers) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", next ? "visible" : "none");
    }
    renderLabels();
    if (!next) popup?.remove();
  }

  // ---- Ma'lumot ----
  function withLabels(result) {
    return (result.regions ?? []).map((region, index) => ({
      ...region,
      labelPoint: result.labels?.features?.[index]?.geometry?.coordinates ?? null,
    }));
  }

  function paintRegions() {
    const features = [...viloyatlar, ...tumanlar].map((region) => ({
      type: "Feature",
      id: region.id,
      geometry: region.geometry,
      properties: {
        id: region.id,
        name: region.name,
        level: region.level,
        parentId: region.parentId,
        colorIndex: region.colorIndex ?? -1,
      },
    }));
    map.getSource("regions-source")?.setData({ type: "FeatureCollection", features });
    renderLabels();
    updateCount();
  }

  async function loadMask() {
    try {
      const result = await api("/regions?level=davlat");
      const country = result.geojson?.features?.[0]?.geometry ?? null;
      map.getSource("country-mask-source")?.setData({
        type: "FeatureCollection",
        features: [createMaskFeature(country)],
      });
    } catch (error) {
      // Niqob bo'lmasa xarita baribir ishlaydi — shunchaki qo'shni
      // davlatlar ham ko'rinib turadi.
      console.error("Mamlakat niqobi yuklanmadi:", error);
    }
  }

  async function loadViloyatlar() {
    try {
      const result = await api("/regions?level=viloyat");
      viloyatlar = withLabels(result);
      paintRegions();
    } catch (error) {
      console.error("Viloyatlarni yuklashda xato:", error);
      if (dom.count) dom.count.textContent = "yuklanmadi";
    }
  }

  async function loadTumanlar() {
    if (map.getZoom() < TUMAN_ZOOM) {
      if (tumanlar.length > 0) { tumanlar = []; paintRegions(); }
      return;
    }
    const bounds = map.getBounds();
    const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
      .map((value) => Number(value.toFixed(3)));
    const key = bbox.join(",");
    if (key === lastTumanKey) return;
    lastTumanKey = key;

    const token = ++loadToken;
    try {
      const result = await api(`/regions?level=tuman&bbox=${encodeURIComponent(key)}`);
      // Sekin javob yangiroq so'rovni bosib ketmasligi kerak.
      if (token !== loadToken) return;
      tumanlar = withLabels(result);
      paintRegions();
    } catch (error) {
      console.error("Tumanlarni yuklashda xato:", error);
    }
  }

  function onMove() {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (visible) loadTumanlar();
      renderLabels();
    }, MOVE_DEBOUNCE_MS);
  }

  function updateCount() {
    if (!dom.count) return;
    const zoom = map.getZoom();
    dom.count.textContent = zoom < TUMAN_ZOOM
      ? `${viloyatlar.length} viloyat`
      : `${viloyatlar.length} viloyat · ${tumanlar.length} tuman`;
  }

  map.on("moveend", onMove);
  map.on("zoomend", onMove);

  dom.toggle?.addEventListener("change", () => setVisible(dom.toggle.checked));
  if (dom.toggle) setVisible(dom.toggle.checked);

  async function load() {
    await Promise.all([loadMask(), loadViloyatlar()]);
    lastTumanKey = "";
    await loadTumanlar();
  }

  load();

  return { reload: load, setVisible, getRegions: () => [...viloyatlar, ...tumanlar] };
}

function collectDom() {
  const $ = (selector) => document.querySelector(selector);
  return {
    toggle: $("#regionsToggle"),
    count: $("#regionsCount"),
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}
