// Hudud qatlami — tuman va mahalla chegaralari.
//
// buildings-app.mjs bilan bir xil naqsh: app.js undan initRegions() ni
// chaqiradi va xarita obyektini beradi. Hech qanday global funksiya
// almashtirilmaydi.
//
// Qatlam yo'l va bino ostiga qo'yiladi (beforeId) — chegara fon ma'lumoti,
// u asosiy mazmunni bekitmasligi kerak.

import { createRegionLayers, REGION_LABEL_COLOR } from "./region-style.mjs";

const emptyFC = () => ({ type: "FeatureCollection", features: [] });

const levelLabels = { tuman: "Tuman", mahalla: "Mahalla" };

export function initRegions(map, ctx) {
  const { maplibre, api, toast, beforeId } = ctx;
  const dom = collectDom();

  let regions = [];
  let labelMarkers = [];
  let visible = true;

  // ---- Xarita qatlamlari ----
  map.addSource("regions-source", { type: "geojson", data: emptyFC() });
  for (const layer of createRegionLayers()) {
    // beforeId berilgan bo'lsa, hudud qatlami yo'llar ostiga tushadi.
    if (beforeId && map.getLayer(beforeId)) map.addLayer(layer, beforeId);
    else map.addLayer(layer);
  }

  map.on("click", "regions-fill", (event) => {
    if (!visible || window.__buildingDrawing) return;
    const properties = event.features?.[0]?.properties;
    if (!properties) return;
    // Yo'l yoki bino tanlangan bo'lsa, ular ustun — hudud faqat bo'sh
    // joyga bosilganda javob beradi.
    const above = map.queryRenderedFeatures(event.point, {
      layers: ["roads-fill", "buildings-fill"].filter((id) => map.getLayer(id)),
    });
    if (above.length > 0) return;
    showRegionPopup(properties, event.lngLat);
  });

  let popup = null;
  function showRegionPopup(properties, lngLat) {
    popup?.remove();
    const parent = regions.find((region) => region.id === properties.parentId);
    const lines = [
      `<strong>${escapeHtml(properties.name)}</strong>`,
      `<span>${levelLabels[properties.level] ?? properties.level}</span>`,
    ];
    if (parent) lines.push(`<span>${escapeHtml(parent.name)} tarkibida</span>`);
    popup = new maplibre.Popup({ closeButton: true, className: "region-popup" })
      .setLngLat(lngLat)
      .setHTML(`<div class="region-popup-body">${lines.join("")}</div>`)
      .addTo(map);
  }

  // ---- Nomlar ----
  // MapLibre symbol qatlami o'rniga HTML belgi: xarita uslubida glyphs
  // manzili yo'q. 14 ta tuman uchun bu yengil; mahalla qo'shilganda
  // faqat ko'rinayotgan hududdagilar chiziladi.
  function renderLabels() {
    for (const marker of labelMarkers) marker.remove();
    labelMarkers = [];
    if (!visible) return;

    for (const region of regions) {
      const element = document.createElement("span");
      element.className = `region-label region-label-${region.level}`;
      element.textContent = region.name;
      element.style.color = REGION_LABEL_COLOR;
      const marker = new maplibre.Marker({ element, anchor: "center" })
        .setLngLat(region.labelPoint)
        .addTo(map);
      labelMarkers.push(marker);
    }
  }

  function setVisible(next) {
    visible = next;
    for (const id of ["regions-fill", "regions-line"]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", next ? "visible" : "none");
    }
    renderLabels();
    if (!next) popup?.remove();
  }

  async function load() {
    try {
      const result = await api("/regions");
      regions = (result.regions ?? []).map((region, index) => ({
        ...region,
        labelPoint: result.labels?.features?.[index]?.geometry?.coordinates
          ?? fallbackLabelPoint(result.geojson, region.id),
      }));
      map.getSource("regions-source")?.setData(result.geojson ?? emptyFC());
      renderLabels();
      updateCount();
    } catch (error) {
      // Hudud qatlami yo'q bo'lsa xarita baribir ishlashi kerak —
      // shuning uchun bu xato butun sahifani to'xtatmaydi.
      console.error("Hududlarni yuklashda xato:", error);
      if (dom.count) dom.count.textContent = "yuklanmadi";
    }
  }

  function updateCount() {
    if (!dom.count) return;
    const tumanCount = regions.filter((region) => region.level === "tuman").length;
    const mahallaCount = regions.filter((region) => region.level === "mahalla").length;
    dom.count.textContent = mahallaCount > 0
      ? `${tumanCount} tuman · ${mahallaCount} mahalla`
      : `${tumanCount} tuman`;
  }

  dom.toggle?.addEventListener("change", () => setVisible(dom.toggle.checked));
  if (dom.toggle) setVisible(dom.toggle.checked);

  load();

  return { reload: load, setVisible, getRegions: () => regions };
}

function collectDom() {
  const $ = (selector) => document.querySelector(selector);
  return {
    toggle: $("#regionsToggle"),
    count: $("#regionsCount"),
  };
}

function fallbackLabelPoint(geojson, id) {
  const feature = geojson?.features?.find((item) => item.properties?.id === id);
  const rings = feature?.geometry?.type === "MultiPolygon"
    ? feature.geometry.coordinates[0]
    : feature?.geometry?.coordinates;
  const ring = rings?.[0] ?? [[0, 0]];
  const points = ring.length > 1 ? ring.slice(0, -1) : ring;
  const sum = points.reduce((acc, [lng, lat]) => [acc[0] + lng, acc[1] + lat], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}
