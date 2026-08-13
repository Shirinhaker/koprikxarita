// Bino boshqaruvi — o‘zini o‘zi ta’minlaydigan modul. app.js (yo‘llar) kodiga
// tegmaydi; xaritaga o‘z manba/qatlamlarini qo‘shadi va o‘z rejimini yuritadi.
//
// Ichida: Esri "proyektor" (xira sun'iy yo'ldosh foni, opacity slider bilan),
// bino poligonlarini ko‘rsatish, poligon chizish, tekshirish (verify) va nashr.

import {
  attachEsriProjector,
  setEsriOpacity,
  setEsriVisible,
} from "./esri-layer.mjs";
import {
  createSavedBuildingLayers,
  createDraftBuildingLayers,
} from "./building-style.mjs";

const buildingTypeLabels = {
  residential: "Turar-joy", commercial: "Tijorat", industrial: "Sanoat",
  public: "Jamoat", religious: "Diniy", education: "Ta’lim",
  health: "Sog‘liq", other: "Boshqa",
};
const statusLabels = { draft: "Draft", published: "Nashr qilingan", archived: "Arxiv" };
const sourceLabels = { manual: "Qo‘lda", osm: "OSM", microsoft: "Microsoft", other: "Boshqa" };

const emptyFC = () => ({ type: "FeatureCollection", features: [] });
const round7 = (c) => [Number(c[0].toFixed(7)), Number(c[1].toFixed(7))];

export function initBuildings(map, ctx) {
  const { config, maplibre, isAdmin, api, toast } = ctx;
  const dom = collectDom();

  let buildings = [];
  let selected = null;
  let drawing = false;
  let draftPoints = [];
  let vertexMarkers = [];
  let popup = null;

  // ---- Xarita qatlamlari ----
  // Esri proyektorni binolar ostiga qo‘yamiz (beforeId = birinchi bino qatlami).
  map.addSource("buildings-source", { type: "geojson", data: emptyFC() });
  createSavedBuildingLayers().forEach((layer) => map.addLayer(layer));
  attachEsriProjector(map, {
    tileUrl: config.esriTileUrl,
    attribution: config.esriAttribution,
    opacity: config.esriOpacity ?? 0.35,
    beforeId: "buildings-fill",
  });
  // Standart holatda proyektor o‘chiq — foydalanuvchi yoqqanda ko‘rinadi.
  setEsriVisible(map, false);

  map.addSource("draft-building-source", { type: "geojson", data: emptyFC() });
  createDraftBuildingLayers().forEach((layer) => map.addLayer(layer));

  // ---- Bino tanlash (chizish rejimidan tashqarida) ----
  map.on("mouseenter", "buildings-fill", () => { if (!drawing) map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "buildings-fill", () => { map.getCanvas().style.cursor = drawing ? "crosshair" : ""; });
  map.on("click", "buildings-fill", (event) => {
    if (drawing) return;
    const id = event.features?.[0]?.properties?.id;
    const building = buildings.find((b) => b.id === id);
    if (building) selectBuilding(building, event.lngLat);
  });

  // ---- Chizish: xaritani bosib poligon nuqtalarini qo‘shish ----
  map.on("click", (event) => {
    if (!drawing) return;
    draftPoints.push(round7([event.lngLat.lng, event.lngLat.lat]));
    renderDraft();
  });

  function renderDraft() {
    const features = [];
    if (draftPoints.length >= 3) {
      features.push({
        type: "Feature",
        properties: { kind: "polygon" },
        geometry: { type: "Polygon", coordinates: [[...draftPoints, draftPoints[0]]] },
      });
    } else if (draftPoints.length === 2) {
      features.push({
        type: "Feature",
        properties: { kind: "polygon" },
        geometry: { type: "LineString", coordinates: draftPoints },
      });
    }
    draftPoints.forEach((coordinate, index) => {
      features.push({ type: "Feature", properties: { kind: "point", index }, geometry: { type: "Point", coordinates: coordinate } });
    });
    map.getSource("draft-building-source")?.setData({ type: "FeatureCollection", features });
    if (dom.pointCount) dom.pointCount.textContent = `${draftPoints.length} nuqta`;
    if (dom.finishButton) dom.finishButton.disabled = draftPoints.length < 3;
    if (dom.undoButton) dom.undoButton.disabled = draftPoints.length === 0;
    renderVertexMarkers();
  }

  function renderVertexMarkers() {
    vertexMarkers.forEach((m) => m.remove());
    vertexMarkers = [];
    if (!drawing) return;
    draftPoints.forEach((coordinate, index) => {
      const element = document.createElement("div");
      element.className = "vertex-marker";
      element.title = `${index + 1}-nuqta`;
      element.addEventListener("click", (e) => e.stopPropagation());
      const marker = new maplibre.Marker({ element, draggable: true }).setLngLat(coordinate).addTo(map);
      marker.on("drag", () => {
        const v = marker.getLngLat();
        draftPoints[index] = round7([v.lng, v.lat]);
        const src = map.getSource("draft-building-source");
        if (src && draftPoints.length >= 3) {
          src.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: { kind: "polygon" }, geometry: { type: "Polygon", coordinates: [[...draftPoints, draftPoints[0]]] } }] });
        }
      });
      marker.on("dragend", renderDraft);
      vertexMarkers.push(marker);
    });
  }

  function startDraw() {
    if (!isAdmin()) { toast("Chizish uchun administrator kiring", "error"); return; }
    drawing = true;
    window.__buildingDrawing = true;
    draftPoints = [];
    selected = null;
    closePopup();
    map.getCanvas().style.cursor = "crosshair";
    dom.panel?.classList.add("drawing");
    if (dom.form) dom.form.hidden = false;
    if (dom.hint) dom.hint.textContent = "Bino burchaklarini xaritada bosib belgilang (kamida 3 ta). Nuqtalarni surib tuzating.";
    if (dom.drawButton) dom.drawButton.classList.add("active");
    renderDraft();
  }

  function cancelDraw() {
    drawing = false;
    window.__buildingDrawing = false;
    draftPoints = [];
    vertexMarkers.forEach((m) => m.remove());
    vertexMarkers = [];
    map.getCanvas().style.cursor = "";
    dom.panel?.classList.remove("drawing");
    if (dom.form) { dom.form.hidden = true; dom.form.reset?.(); }
    if (dom.drawButton) dom.drawButton.classList.remove("active");
    map.getSource("draft-building-source")?.setData(emptyFC());
  }

  function undoPoint() {
    if (!draftPoints.length) return;
    draftPoints.pop();
    renderDraft();
  }

  async function saveDraft(event) {
    event?.preventDefault?.();
    if (draftPoints.length < 3) { toast("Bino kamida 3 nuqtadan iborat bo‘lishi kerak", "error"); return; }
    const payload = {
      name: dom.name?.value ?? "",
      buildingType: dom.type?.value ?? "residential",
      levels: dom.levels?.value ? Number(dom.levels.value) : null,
      districtName: dom.district?.value ?? "",
      neighborhoodName: dom.neighborhood?.value ?? "",
      source: "manual",
      geometry: { type: "Polygon", coordinates: [[...draftPoints, draftPoints[0]]] },
    };
    try {
      const result = await api("/buildings", { method: "POST", body: JSON.stringify(payload) });
      cancelDraw();
      await reload();
      toast("Bino draft sifatida saqlandi", "success");
      (result.warnings ?? []).forEach((w) => toast(w, "error"));
    } catch (error) {
      toast(error.message, "error");
    }
  }

  // ---- Tanlangan bino: popup + administrator amallari ----
  function selectBuilding(building, lngLat) {
    selected = building;
    closePopup();
    const levels = building.levels != null ? `${building.levels} qavat` : "—";
    const verifiedBadge = building.verified ? "✓ tekshirilgan" : "tekshirilmagan";
    const container = document.createElement("div");
    container.className = "building-popup";
    container.innerHTML = `
      <strong>${escapeHtml(building.name || "Nomsiz bino")}</strong>
      <div class="bp-row"><span class="bp-chip status-${building.status}">${statusLabels[building.status] ?? building.status}</span>
      <span class="bp-chip">${sourceLabels[building.source] ?? building.source}</span>
      <span class="bp-chip ${building.verified ? "ok" : "warn"}">${verifiedBadge}</span></div>
      <dl class="bp-meta">
        <div><dt>Turi</dt><dd>${buildingTypeLabels[building.buildingType] ?? building.buildingType}</dd></div>
        <div><dt>Qavat</dt><dd>${levels}</dd></div>
        <div><dt>Maydon</dt><dd>${building.areaSqm ? `${Math.round(building.areaSqm)} m²` : "—"}</dd></div>
      </dl>`;
    if (isAdmin()) container.append(buildActions(building));
    popup = new maplibre.Popup({ closeButton: true, maxWidth: "260px" })
      .setLngLat(lngLat ?? centroid(building.geometry))
      .setDOMContent(container)
      .addTo(map);
  }

  function buildActions(building) {
    const wrap = document.createElement("div");
    wrap.className = "bp-actions";
    const actions = [];
    if (!building.verified && building.status !== "archived") actions.push(["Tekshirildi", "button-secondary", () => buildingAction(building, "verify")]);
    if (building.verified && building.status !== "published") actions.push(["Bekor", "button-secondary", () => buildingAction(building, "unverify")]);
    if (building.status === "draft") actions.push(["Nashr", "button-success", () => buildingAction(building, "publish")]);
    if (building.status !== "archived") actions.push(["Arxiv", "button-danger", () => buildingAction(building, "archive")]);
    if (building.status === "archived") actions.push(["Tiklash", "button-success", () => buildingAction(building, "restore")]);
    actions.forEach(([label, cls, handler]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `button ${cls} bp-btn`;
      button.textContent = label;
      button.addEventListener("click", handler);
      wrap.append(button);
    });
    return wrap;
  }

  async function buildingAction(building, action) {
    try {
      if (action === "archive") {
        if (!confirm(`“${building.name || "Nomsiz bino"}” arxivlansinmi?`)) return;
        await api(`/buildings/${building.id}`, { method: "DELETE" });
      } else {
        await api(`/buildings/${building.id}/${action}`, { method: "POST" });
      }
      const messages = { verify: "Tekshirildi deb belgilandi", unverify: "Tekshiruv bekor qilindi", publish: "Bino nashr qilindi", archive: "Bino arxivlandi", restore: "Bino tiklandi" };
      toast(messages[action] ?? "Bajarildi", "success");
      closePopup();
      await reload();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function closePopup() { popup?.remove(); popup = null; }

  // ---- Yuklash ----
  async function reload() {
    const status = isAdmin() && dom.statusFilter ? dom.statusFilter.value : "published";
    try {
      const result = await api(`/buildings?status=${encodeURIComponent(status)}`);
      buildings = result.buildings ?? [];
      map.getSource("buildings-source")?.setData(result.geojson ?? emptyFC());
      if (dom.count) dom.count.textContent = `${buildings.length} ta`;
    } catch (error) {
      if (dom.count) dom.count.textContent = "—";
    }
  }

  // ---- Proyektor boshqaruvi ----
  function toggleImagery(visible) {
    setEsriVisible(map, visible);
    if (dom.opacity) dom.opacity.disabled = !visible;
  }
  function setImageryOpacity(value) {
    setEsriOpacity(map, Number(value) / 100);
  }

  // ---- Interfeys hodisalari ----
  dom.drawButton?.addEventListener("click", () => (drawing ? cancelDraw() : startDraw()));
  dom.finishButton?.addEventListener("click", saveDraft);
  dom.cancelButton?.addEventListener("click", cancelDraw);
  dom.undoButton?.addEventListener("click", undoPoint);
  dom.form?.addEventListener("submit", saveDraft);
  dom.statusFilter?.addEventListener("change", reload);
  dom.imageryToggle?.addEventListener("change", (e) => toggleImagery(e.target.checked));
  dom.opacity?.addEventListener("input", (e) => setImageryOpacity(e.target.value));
  if (dom.opacity) { dom.opacity.value = String(Math.round((config.esriOpacity ?? 0.35) * 100)); dom.opacity.disabled = true; }
  document.addEventListener("keydown", (event) => {
    if (!drawing) return;
    if (event.key === "Escape") cancelDraw();
    if ((event.key === "Backspace" || event.key === "Delete") && document.activeElement?.tagName !== "INPUT") { event.preventDefault(); undoPoint(); }
  });

  reload();
  return { reload, toggleImagery, setImageryOpacity, startDraw, cancelDraw };
}

// ---- Yordamchilar ----
function collectDom() {
  const $ = (s) => document.querySelector(s);
  return {
    panel: $("#buildingsPanel"),
    drawButton: $("#buildingDrawButton"),
    finishButton: $("#buildingFinishButton"),
    cancelButton: $("#buildingCancelButton"),
    undoButton: $("#buildingUndoButton"),
    pointCount: $("#buildingPointCount"),
    hint: $("#buildingHint"),
    form: $("#buildingForm"),
    name: $("#buildingName"),
    type: $("#buildingType"),
    levels: $("#buildingLevels"),
    district: $("#buildingDistrict"),
    neighborhood: $("#buildingNeighborhood"),
    statusFilter: $("#buildingStatusFilter"),
    count: $("#buildingCount"),
    imageryToggle: $("#imageryToggle"),
    opacity: $("#imageryOpacity"),
  };
}

function centroid(geometry) {
  const ring = geometry.coordinates[0];
  let x = 0; let y = 0;
  for (let i = 0; i < ring.length - 1; i += 1) { x += ring[i][0]; y += ring[i][1]; }
  const n = ring.length - 1;
  return [x / n, y / n];
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
