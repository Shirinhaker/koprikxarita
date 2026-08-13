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
  let importPollTimer = null;
  let lastImportState = "idle";
  let lastImportedCount = 0;
  let viewportReloadTimer = null;

  map.addSource("buildings-source", { type: "geojson", data: emptyFC() });
  createSavedBuildingLayers().forEach((layer) => map.addLayer(layer));
  attachEsriProjector(map, {
    tileUrl: config.esriTileUrl,
    attribution: config.esriAttribution,
    opacity: config.esriOpacity ?? 0.35,
    beforeId: "buildings-fill",
  });
  setEsriVisible(map, false);

  map.addSource("draft-building-source", { type: "geojson", data: emptyFC() });
  createDraftBuildingLayers().forEach((layer) => map.addLayer(layer));

  map.on("mouseenter", "buildings-fill", () => { if (!drawing) map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "buildings-fill", () => { map.getCanvas().style.cursor = drawing ? "crosshair" : ""; });
  map.on("click", "buildings-fill", (event) => {
    if (drawing) return;
    const id = event.features?.[0]?.properties?.id;
    const building = buildings.find((b) => b.id === id);
    if (building) selectBuilding(building, event.lngLat);
  });

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

  function currentViewportBbox() {
    if (map.getZoom() < 12) return null;
    const bounds = map.getBounds();
    return [
      bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(),
    ].map((value) => Number(value.toFixed(6)));
  }

  async function reload({ skipImportStatus = false } = {}) {
    const status = isAdmin() && dom.statusFilter ? dom.statusFilter.value : "published";
    const bbox = currentViewportBbox();
    if (!bbox) {
      buildings = [];
      map.getSource("buildings-source")?.setData(emptyFC());
      if (dom.count) dom.count.textContent = "Yaqinlashtiring";
    } else {
      try {
        const viewportQuery = `__viewport__:${bbox.join(",")};6000`;
        const result = await api(`/buildings/search?status=${encodeURIComponent(status)}&q=${encodeURIComponent(viewportQuery)}`);
        buildings = result.buildings ?? [];
        map.getSource("buildings-source")?.setData(result.geojson ?? emptyFC());
        if (dom.count) dom.count.textContent = `${buildings.length} ta`;
      } catch (error) {
        if (dom.count) dom.count.textContent = "—";
      }
    }
    ensureMicrosoftImportControls();
    if (dom.microsoftImportWrap) dom.microsoftImportWrap.hidden = !isAdmin();
    if (!skipImportStatus) refreshImportStatus();
  }

  function scheduleViewportReload() {
    clearTimeout(viewportReloadTimer);
    viewportReloadTimer = setTimeout(() => reload({ skipImportStatus: true }), 180);
  }

  function ensureMicrosoftImportControls() {
    if (!dom.panel || dom.microsoftImportWrap) return;
    const wrap = document.createElement("div");
    wrap.className = "microsoft-import-controls admin-only";
    wrap.hidden = !isAdmin();
    wrap.style.display = "grid";
    wrap.style.gap = "8px";
    wrap.style.margin = "12px 0";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-secondary button-wide";
    button.textContent = "Microsoft binolarini yuklash";

    const status = document.createElement("p");
    status.className = "helper-text";
    status.textContent = "Microsoft Building Footprints holati tekshirilmoqda…";

    wrap.append(button, status);
    const imagery = dom.panel.querySelector(".imagery-controls");
    if (imagery) imagery.before(wrap);
    else dom.panel.append(wrap);

    dom.microsoftImportWrap = wrap;
    dom.microsoftImportButton = button;
    dom.microsoftImportStatus = status;
    button.addEventListener("click", startMicrosoftImport);
  }

  function importStatusText(status) {
    if (!status) return "Microsoft import holati noma’lum";
    if (status.state === "running") {
      const tile = status.totalTiles ? ` · tayl ${status.currentTile}/${status.totalTiles}` : "";
      return `Yuklanmoqda: ${status.imported ?? 0} ta bino${tile}`;
    }
    if (status.state === "failed") return `Import xatosi: ${status.error || "noma’lum xato"}`;
    if (status.state === "completed") {
      return status.message || `Microsoft binolari tayyor: ${status.imported ?? 0} ta`;
    }
    return "Microsoft binolari hali yuklanmagan";
  }

  function renderImportStatus(status) {
    ensureMicrosoftImportControls();
    if (!dom.microsoftImportWrap) return;
    dom.microsoftImportWrap.hidden = !isAdmin();
    if (!isAdmin()) return;
    if (dom.microsoftImportStatus) dom.microsoftImportStatus.textContent = importStatusText(status);
    if (dom.microsoftImportButton) {
      dom.microsoftImportButton.disabled = status?.state === "running";
      dom.microsoftImportButton.textContent = status?.state === "running"
        ? "Microsoft binolari yuklanmoqda…"
        : "Microsoft binolarini yuklash";
    }
  }

  function scheduleImportPoll() {
    clearTimeout(importPollTimer);
    importPollTimer = setTimeout(() => refreshImportStatus(), 1800);
  }

  async function refreshImportStatus() {
    ensureMicrosoftImportControls();
    if (!isAdmin()) {
      clearTimeout(importPollTimer);
      if (dom.microsoftImportWrap) dom.microsoftImportWrap.hidden = true;
      return;
    }
    try {
      const result = await api("/buildings/import-microsoft/status");
      const status = result.status ?? { state: "idle", imported: 0 };
      renderImportStatus(status);

      if ((status.imported ?? 0) !== lastImportedCount) {
        lastImportedCount = status.imported ?? 0;
        if (dom.statusFilter) dom.statusFilter.value = "all";
        await reload({ skipImportStatus: true });
      }

      if (lastImportState === "running" && status.state === "completed") {
        if (dom.statusFilter) dom.statusFilter.value = "all";
        await reload({ skipImportStatus: true });
        toast(`${status.imported ?? 0} ta Microsoft binosi yuklandi`, "success");
      }
      lastImportState = status.state;
      if (status.state === "running") scheduleImportPoll();
    } catch (error) {
      if (dom.microsoftImportStatus) dom.microsoftImportStatus.textContent = `Import holati olinmadi: ${error.message}`;
    }
  }

  async function startMicrosoftImport() {
    if (!isAdmin()) return;
    ensureMicrosoftImportControls();
    if (dom.microsoftImportButton) dom.microsoftImportButton.disabled = true;
    try {
      const result = await api("/buildings/import-microsoft", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const status = result.status ?? { state: result.started ? "running" : "idle" };
      renderImportStatus(status);
      if (result.started) toast("Microsoft binolarini yuklash boshlandi", "success");
      else if (status.message) toast(status.message);
      lastImportState = status.state;
      if (dom.statusFilter) dom.statusFilter.value = "all";
      await reload({ skipImportStatus: true });
      if (status.state === "running") scheduleImportPoll();
    } catch (error) {
      toast(error.message, "error");
      if (dom.microsoftImportButton) dom.microsoftImportButton.disabled = false;
    }
  }

  function toggleImagery(visible) {
    setEsriVisible(map, visible);
    if (dom.opacity) dom.opacity.disabled = !visible;
  }
  function setImageryOpacity(value) {
    setEsriOpacity(map, Number(value) / 100);
  }

  dom.drawButton?.addEventListener("click", () => (drawing ? cancelDraw() : startDraw()));
  dom.finishButton?.addEventListener("click", saveDraft);
  dom.cancelButton?.addEventListener("click", cancelDraw);
  dom.undoButton?.addEventListener("click", undoPoint);
  dom.form?.addEventListener("submit", saveDraft);
  dom.statusFilter?.addEventListener("change", reload);
  map.on("moveend", scheduleViewportReload);
  dom.imageryToggle?.addEventListener("change", (e) => toggleImagery(e.target.checked));
  dom.opacity?.addEventListener("input", (e) => setImageryOpacity(e.target.value));
  if (dom.opacity) { dom.opacity.value = String(Math.round((config.esriOpacity ?? 0.35) * 100)); dom.opacity.disabled = true; }
  document.addEventListener("keydown", (event) => {
    if (!drawing) return;
    if (event.key === "Escape") cancelDraw();
    if ((event.key === "Backspace" || event.key === "Delete") && document.activeElement?.tagName !== "INPUT") { event.preventDefault(); undoPoint(); }
  });

  ensureMicrosoftImportControls();
  reload();
  return { reload, refreshImportStatus, toggleImagery, setImageryOpacity, startDraw, cancelDraw };
}

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
    microsoftImportWrap: null,
    microsoftImportButton: null,
    microsoftImportStatus: null,
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
