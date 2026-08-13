import { createEditorState } from "./editor-state.mjs";
import { createOsmRasterStyle } from "./map-style.mjs";
import { createSavedRoadLayers, createDraftRoadLayers } from "./road-style.mjs";
import { snapCoordinateToRoads } from "./road-snap.mjs";
import { initBuildings } from "./buildings-app.mjs";

let buildingsController = null;

const config = window.KOPRIK_CONFIG ?? {
  apiBase: "/api",
  osmTileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  mapAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
  center: [67.27, 37.94],
  zoom: 8,
};

const $ = (selector) => document.querySelector(selector);
const dom = {
  searchInput: $("#searchInput"), authButton: $("#authButton"), roleLabel: $("#roleLabel"), connectionBadge: $("#connectionBadge"),
  adminTools: $("#adminTools"), modeLabel: $("#modeLabel"), drawButton: $("#drawButton"), editButton: $("#editButton"),
  undoPointButton: $("#undoPointButton"), cancelButton: $("#cancelButton"), drawHint: $("#drawHint"), roadForm: $("#roadForm"),
  formTitle: $("#formTitle"), pointCount: $("#pointCount"), roadName: $("#roadName"), roadType: $("#roadType"), surface: $("#surface"),
  direction: $("#direction"), districtName: $("#districtName"), neighborhoodName: $("#neighborhoodName"), formError: $("#formError"),
  saveRoadButton: $("#saveRoadButton"), finishDrawButton: $("#finishDrawButton"), selectedSection: $("#selectedSection"),
  selectedStatus: $("#selectedStatus"), selectedName: $("#selectedName"), selectedDistrict: $("#selectedDistrict"),
  selectedNeighborhood: $("#selectedNeighborhood"), selectedType: $("#selectedType"), selectedSurface: $("#selectedSurface"),
  selectedActions: $("#selectedActions"), resultCount: $("#resultCount"), roadsList: $("#roadsList"), statusFilterWrap: $("#statusFilterWrap"),
  statusFilter: $("#statusFilter"), mapLoading: $("#mapLoading"), centerMapButton: $("#centerMapButton"), attributionButton: $("#attributionButton"),
  mapInstruction: $("#mapInstruction"), loginDialog: $("#loginDialog"), loginForm: $("#loginForm"), loginName: $("#loginName"),
  loginPassword: $("#loginPassword"), loginError: $("#loginError"), attributionDialog: $("#attributionDialog"), toastRegion: $("#toastRegion"),
};

const roadTypeLabels = { residential: "Ichki ko‘cha", service: "Xizmat yo‘li", pedestrian: "Piyodalar yo‘li", track: "Dala yo‘li", other: "Boshqa" };
const surfaceLabels = { asphalt: "Asfalt", concrete: "Beton", gravel: "Shag‘al", ground: "Tuproq", unknown: "Noma’lum" };
const statusLabels = { draft: "Draft", published: "Nashr qilingan", archived: "Arxiv" };

let token = localStorage.getItem("koprik_xarita_token") ?? "";
let user = null;
let roads = [];
let selectedRoad = null;
let editingRoad = null;
let mode = "idle";
let draftCoordinates = [];
let vertexMarkers = [];
let map;
let mapReady = false;
let searchTimer;

const editor = createEditorState({ saveRoad: saveRoadRequest });

function toast(message, type = "info") {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  dom.toastRegion.append(item);
  setTimeout(() => item.remove(), 3300);
}

function showError(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

async function api(path, options = {}) {
  const headers = { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers ?? {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${config.apiBase}${path}`, { ...options, headers });
  let body = {};
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) {
    const error = new Error(body.message ?? `Server xatosi (${response.status})`);
    error.status = response.status;
    error.code = body.code;
    throw error;
  }
  return body;
}

async function refreshConnection() {
  try {
    await api("/health");
    dom.connectionBadge.classList.add("online");
  } catch {
    dom.connectionBadge.classList.remove("online");
  }
}

async function refreshUser() {
  if (!token) {
    user = null;
    renderAuth();
    return;
  }
  try {
    const result = await api("/auth/me");
    user = result.user;
  } catch {
    token = "";
    user = null;
    localStorage.removeItem("koprik_xarita_token");
  }
  renderAuth();
}

function isAdmin() { return user?.role === "admin"; }

function renderAuth() {
  const adminElements = document.querySelectorAll(".admin-only");
  adminElements.forEach((element) => { element.hidden = !isAdmin(); });
  dom.roleLabel.textContent = isAdmin() ? "Administrator rejimi" : "Ko‘rish rejimi";
  dom.authButton.querySelector("span").textContent = isAdmin() ? user.fullName : "Admin kirish";
  dom.statusFilterWrap.hidden = !isAdmin();
  if (!isAdmin() && mode !== "idle") cancelEditing();
  reloadRoads();
  buildingsController?.reload();
}

function loginDialogOpen() {
  if (isAdmin()) {
    token = "";
    user = null;
    localStorage.removeItem("koprik_xarita_token");
    renderAuth();
    toast("Tizimdan chiqdingiz");
    return;
  }
  dom.loginDialog.showModal();
  setTimeout(() => dom.loginName.focus(), 50);
}

async function handleLogin(event) {
  event.preventDefault();
  showError(dom.loginError, "");
  try {
    const result = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ login: dom.loginName.value.trim(), password: dom.loginPassword.value }),
    });
    token = result.token;
    user = result.user;
    localStorage.setItem("koprik_xarita_token", token);
    dom.loginDialog.close();
    renderAuth();
    toast("Administrator rejimi ochildi", "success");
  } catch (error) {
    showError(dom.loginError, error.message);
  }
}

function emptyFeatureCollection() { return { type: "FeatureCollection", features: [] }; }

function roadToFeature(road) {
  return {
    type: "Feature",
    id: road.id,
    geometry: road.geometry,
    properties: { id: road.id, name: road.name, status: road.status, roadType: road.roadType, surface: road.surface },
  };
}

function updateMapRoads() {
  if (!mapReady) return;
  map.getSource("roads-source")?.setData({ type: "FeatureCollection", features: roads.map(roadToFeature) });
}

function updateDraftMap() {
  if (!mapReady) return;
  const features = [];
  if (draftCoordinates.length >= 2) {
    features.push({ type: "Feature", properties: { kind: "line" }, geometry: { type: "LineString", coordinates: draftCoordinates } });
  }
  draftCoordinates.forEach((coordinate, index) => {
    features.push({ type: "Feature", properties: { kind: "point", index }, geometry: { type: "Point", coordinates: coordinate } });
  });
  map.getSource("draft-source")?.setData({ type: "FeatureCollection", features });
  dom.pointCount.textContent = `${draftCoordinates.length} nuqta`;
  dom.undoPointButton.disabled = draftCoordinates.length === 0;
  renderVertexMarkers();
}

function setupMapLayers() {
  map.addSource("roads-source", { type: "geojson", data: emptyFeatureCollection() });
  createSavedRoadLayers().forEach((layer) => map.addLayer(layer));

  map.addSource("draft-source", { type: "geojson", data: emptyFeatureCollection() });
  createDraftRoadLayers().forEach((layer) => map.addLayer(layer));

  map.on("mouseenter", "roads-fill", () => { if (mode === "idle") map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "roads-fill", () => { map.getCanvas().style.cursor = mode === "idle" ? "" : "crosshair"; });
  map.on("click", "roads-fill", (event) => {
    if (mode !== "idle" || window.__buildingDrawing) return;
    event.originalEvent.cancelBubble = true;
    const id = event.features?.[0]?.properties?.id;
    const road = roads.find((item) => item.id === id);
    if (road) selectRoad(road, true);
  });
  updateMapRoads();
  updateDraftMap();
}

async function loadMapLibre() {
  if (window.maplibregl) return window.maplibregl;
  return new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-maplibre-css]')) {
      const stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css";
      stylesheet.dataset.maplibreCss = "true";
      document.head.append(stylesheet);
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js";
    script.async = true;
    const timeout = setTimeout(() => {
      script.remove();
      reject(new Error("Xarita kutubxonasini yuklash vaqti tugadi"));
    }, 6000);
    script.addEventListener("load", () => { clearTimeout(timeout); resolve(window.maplibregl); }, { once: true });
    script.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Xarita kutubxonasi yuklanmadi")); }, { once: true });
    document.head.append(script);
  });
}

function normalizedCoordinate(coordinate) {
  return [Number(coordinate[0].toFixed(7)), Number(coordinate[1].toFixed(7))];
}

function snapToEditableRoads(coordinate) {
  if (!mapReady) return normalizedCoordinate(coordinate);
  const candidates = roads.filter((road) => road.id !== editingRoad?.id && road.status !== "archived");
  const result = snapCoordinateToRoads({
    coordinate,
    roads: candidates,
    project: (value) => map.project(value),
    unproject: (value) => map.unproject(value),
    tolerancePx: 14,
  });
  return normalizedCoordinate(result.coordinate);
}

async function initializeMap() {
  try {
    await loadMapLibre();
  } catch (error) {
    dom.mapLoading.innerHTML = `<p>${error.message}. Internet ulanishini tekshiring.</p>`;
    return;
  }
  map = new window.maplibregl.Map({
    container: "map",
    style: createOsmRasterStyle({
      tileUrl: config.osmTileUrl,
      attribution: config.mapAttribution,
    }),
    center: config.center,
    zoom: config.zoom,
    attributionControl: false,
    maplibreLogo: false,
    maxPitch: 0,
  });
  map.addControl(
    new window.maplibregl.AttributionControl({ compact: false }),
    "bottom-right",
  );
  map.on("load", () => {
    mapReady = true;
    setupMapLayers();
    try {
      buildingsController = initBuildings(map, {
        config,
        maplibre: window.maplibregl,
        isAdmin,
        api,
        toast,
      });
    } catch (error) {
      console.error("Binolar qatlamini ulashda xato:", error);
    }
    dom.mapLoading.classList.add("loaded");
  });
  map.on("error", (event) => {
    if (!mapReady) dom.mapLoading.innerHTML = `<p>Xaritani yuklashda xato: ${event.error?.message ?? "noma’lum xato"}</p>`;
  });
  map.on("click", (event) => {
    if (!["drawing", "editing"].includes(mode)) return;
    const coordinate = snapToEditableRoads([event.lngLat.lng, event.lngLat.lat]);
    draftCoordinates.push(coordinate);
    editor.setGeometry({ type: "LineString", coordinates: draftCoordinates });
    updateDraftMap();
  });
}

function renderVertexMarkers() {
  vertexMarkers.forEach((marker) => marker.remove());
  vertexMarkers = [];
  if (!mapReady || !["drawing", "editing"].includes(mode)) return;
  draftCoordinates.forEach((coordinate, index) => {
    const element = document.createElement("div");
    element.className = "vertex-marker";
    element.title = `${index + 1}-nuqta — surib o‘zgartiring`;
    element.addEventListener("click", (event) => event.stopPropagation());
    const marker = new window.maplibregl.Marker({ element, draggable: true })
      .setLngLat(coordinate)
      .addTo(map);
    marker.on("drag", () => {
      const value = marker.getLngLat();
      draftCoordinates[index] = normalizedCoordinate([value.lng, value.lat]);
      editor.setGeometry({ type: "LineString", coordinates: draftCoordinates });
      updateDraftMapWithoutMarkers();
    });
    marker.on("dragend", () => {
      const value = marker.getLngLat();
      const coordinate = snapToEditableRoads([value.lng, value.lat]);
      draftCoordinates[index] = coordinate;
      marker.setLngLat(coordinate);
      editor.setGeometry({ type: "LineString", coordinates: draftCoordinates });
      updateDraftMapWithoutMarkers();
    });
    vertexMarkers.push(marker);
  });
}

function updateDraftMapWithoutMarkers() {
  if (!mapReady) return;
  const features = draftCoordinates.length >= 2
    ? [{ type: "Feature", properties: { kind: "line" }, geometry: { type: "LineString", coordinates: draftCoordinates } }]
    : [];
  map.getSource("draft-source")?.setData({ type: "FeatureCollection", features });
  dom.pointCount.textContent = `${draftCoordinates.length} nuqta`;
}

function setMode(nextMode) {
  mode = nextMode;
  const active = mode !== "idle";
  dom.modeLabel.textContent = mode === "drawing" ? "Chizilmoqda" : mode === "editing" ? "Tahrirlanmoqda" : "Tayyor";
  dom.modeLabel.classList.toggle("active", active);
  dom.cancelButton.disabled = !active;
  dom.mapInstruction.hidden = !active;
  if (mapReady) map.getCanvas().style.cursor = active ? "crosshair" : "";
  dom.drawHint.textContent = active
    ? "Xaritani bosib nuqta qo‘shing. Nuqtalarni surib yo‘l shaklini tuzating."
    : "“Ko‘cha chizish”ni bosing, so‘ng xaritada yo‘l bo‘ylab nuqtalarni belgilang.";
}

function resetForm() {
  dom.roadForm.reset();
  dom.roadType.value = "residential";
  dom.surface.value = "asphalt";
  dom.direction.value = "two_way";
  showError(dom.formError, "");
}

function startDrawing() {
  if (!isAdmin()) return loginDialogOpen();
  editingRoad = null;
  selectedRoad = null;
  draftCoordinates = [];
  resetForm();
  dom.formTitle.textContent = "Yangi ko‘cha";
  dom.saveRoadButton.textContent = "Draftni saqlash";
  dom.roadForm.hidden = false;
  dom.selectedSection.hidden = true;
  setMode("drawing");
  editor.cancel();
  updateMapRoads();
  updateDraftMap();
}

function editSelectedRoad() {
  if (!isAdmin() || !selectedRoad) return;
  editingRoad = structuredClone(selectedRoad);
  draftCoordinates = structuredClone(editingRoad.geometry.coordinates);
  dom.roadName.value = editingRoad.name;
  dom.roadType.value = editingRoad.roadType;
  dom.surface.value = editingRoad.surface;
  dom.direction.value = editingRoad.direction;
  dom.districtName.value = editingRoad.districtName;
  dom.neighborhoodName.value = editingRoad.neighborhoodName;
  dom.formTitle.textContent = "Ko‘chani tahrirlash";
  dom.saveRoadButton.textContent = "O‘zgarishni saqlash";
  dom.roadForm.hidden = false;
  setMode("editing");
  editor.setGeometry({ type: "LineString", coordinates: draftCoordinates });
  updateDraftMap();
}

function cancelEditing() {
  editingRoad = null;
  draftCoordinates = [];
  vertexMarkers.forEach((marker) => marker.remove());
  vertexMarkers = [];
  dom.roadForm.hidden = true;
  editor.cancel();
  setMode("idle");
  updateDraftMap();
  renderSelected();
}

function finishDrawing() {
  if (draftCoordinates.length < 2) {
    showError(dom.formError, "Ko‘cha kamida ikki nuqtadan iborat bo‘lishi kerak");
    return;
  }
  showError(dom.formError, "");
  dom.roadName.focus();
  toast("Chiziq tayyor. Ko‘cha ma’lumotlarini kiriting.");
}

function undoPoint() {
  if (draftCoordinates.length === 0) return;
  draftCoordinates.pop();
  if (draftCoordinates.length > 0) editor.setGeometry({ type: "LineString", coordinates: draftCoordinates });
  updateDraftMap();
}

function formPayload() {
  return {
    name: dom.roadName.value,
    roadType: dom.roadType.value,
    surface: dom.surface.value,
    direction: dom.direction.value,
    status: editingRoad?.status === "published" ? "published" : "draft",
    districtName: dom.districtName.value,
    neighborhoodName: dom.neighborhoodName.value,
    expectedUpdatedAt: editingRoad?.updatedAt,
  };
}

async function saveRoadRequest(payload) {
  const path = editingRoad ? `/roads/${editingRoad.id}` : "/roads";
  return api(path, { method: editingRoad ? "PUT" : "POST", body: JSON.stringify(payload) });
}

async function handleRoadSave(event) {
  event.preventDefault();
  showError(dom.formError, "");
  if (draftCoordinates.length < 2) {
    showError(dom.formError, "Ko‘cha kamida ikki nuqtadan iborat bo‘lishi kerak");
    return;
  }
  dom.saveRoadButton.disabled = true;
  editor.setGeometry({ type: "LineString", coordinates: draftCoordinates });
  const wasEditing = Boolean(editingRoad);
  const result = await editor.save(formPayload());
  dom.saveRoadButton.disabled = false;
  if (!result.ok) {
    showError(dom.formError, result.error);
    if (result.error.includes("boshqa oynada")) toast("Eng yangi ma’lumotni qayta yuklang", "error");
    return;
  }
  const savedRoad = result.road;
  const warnings = savedRoad.warnings ?? [];
  cancelEditing();
  await reloadRoads();
  const fresh = roads.find((road) => road.id === savedRoad.id) ?? savedRoad;
  selectRoad(fresh, true);
  toast(wasEditing ? "Ko‘cha yangilandi" : "Ko‘cha draft sifatida saqlandi", "success");
  warnings.forEach((warning) => toast(warning, "error"));
}

async function roadAction(action) {
  if (!selectedRoad) return;
  try {
    if (action === "archive") {
      if (!confirm(`“${selectedRoad.name || "Nomsiz ko‘cha"}” arxivlansinmi?`)) return;
      await api(`/roads/${selectedRoad.id}`, { method: "DELETE" });
    } else {
      await api(`/roads/${selectedRoad.id}/${action}`, { method: "POST" });
    }
    toast(action === "publish" ? "Ko‘cha nashr qilindi" : action === "restore" ? "Ko‘cha tiklandi" : "Ko‘cha arxivlandi", "success");
    const id = selectedRoad.id;
    await reloadRoads();
    const updated = roads.find((road) => road.id === id);
    if (updated) selectRoad(updated, false); else clearSelection();
  } catch (error) {
    toast(error.message, "error");
  }
}

function selectRoad(road, moveMap = false) {
  selectedRoad = road;
  dom.editButton.disabled = !isAdmin() || road.status === "archived";
  renderSelected();
  renderRoadList();
  updateMapRoads();
  if (moveMap && mapReady && road.geometry.coordinates.length) {
    const bounds = road.geometry.coordinates.reduce(
      (box, coordinate) => box.extend(coordinate),
      new window.maplibregl.LngLatBounds(road.geometry.coordinates[0], road.geometry.coordinates[0]),
    );
    map.fitBounds(bounds, { padding: 90, maxZoom: 17, duration: 650 });
  }
}

function clearSelection() {
  selectedRoad = null;
  dom.editButton.disabled = true;
  renderSelected();
  renderRoadList();
  updateMapRoads();
}

function renderSelected() {
  if (!selectedRoad) {
    dom.selectedSection.hidden = true;
    return;
  }
  dom.selectedSection.hidden = false;
  dom.selectedName.textContent = selectedRoad.name || "Nomsiz ko‘cha";
  dom.selectedStatus.textContent = statusLabels[selectedRoad.status] ?? selectedRoad.status;
  dom.selectedStatus.className = `road-status ${selectedRoad.status}`;
  dom.selectedDistrict.textContent = selectedRoad.districtName || "—";
  dom.selectedNeighborhood.textContent = selectedRoad.neighborhoodName || "—";
  dom.selectedType.textContent = roadTypeLabels[selectedRoad.roadType] ?? selectedRoad.roadType;
  dom.selectedSurface.textContent = surfaceLabels[selectedRoad.surface] ?? selectedRoad.surface;
  dom.selectedActions.hidden = !isAdmin();
  dom.selectedActions.replaceChildren();
  if (!isAdmin()) return;

  const actions = [];
  if (selectedRoad.status !== "archived") actions.push(["Tahrirlash", "button-secondary", editSelectedRoad]);
  if (selectedRoad.status === "draft") actions.push(["Nashr qilish", "button-success", () => roadAction("publish")]);
  if (selectedRoad.status !== "archived") actions.push(["Arxivlash", "button-danger", () => roadAction("archive")]);
  if (selectedRoad.status === "archived") actions.push(["Tiklash", "button-success", () => roadAction("restore")]);
  actions.forEach(([label, className, handler]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button ${className}`;
    button.textContent = label;
    button.addEventListener("click", handler);
    dom.selectedActions.append(button);
  });
}

function renderRoadList() {
  dom.resultCount.textContent = `${roads.length} ta`;
  dom.roadsList.replaceChildren();
  if (!roads.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = dom.searchInput.value.trim() ? "Qidiruv bo‘yicha ko‘cha topilmadi." : "Hozircha ko‘chalar kiritilmagan.";
    dom.roadsList.append(empty);
    return;
  }
  roads.forEach((road) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `road-card ${selectedRoad?.id === road.id ? "selected" : ""}`;
    const title = document.createElement("strong");
    title.textContent = road.name || "Nomsiz ko‘cha";
    const subtitle = document.createElement("small");
    subtitle.textContent = [road.districtName, road.neighborhoodName].filter(Boolean).join(" · ") || roadTypeLabels[road.roadType];
    const status = document.createElement("span");
    status.className = `mini-status ${road.status}`;
    status.title = statusLabels[road.status];
    card.append(title, subtitle, status);
    card.addEventListener("click", () => selectRoad(road, true));
    dom.roadsList.append(card);
  });
}

async function reloadRoads() {
  const query = dom.searchInput.value.trim();
  const status = isAdmin() ? dom.statusFilter.value : "published";
  try {
    const endpoint = query ? `/roads/search?q=${encodeURIComponent(query)}&status=${encodeURIComponent(status)}` : `/roads?status=${encodeURIComponent(status)}`;
    const result = await api(endpoint);
    roads = result.roads;
    if (selectedRoad) selectedRoad = roads.find((road) => road.id === selectedRoad.id) ?? null;
    renderRoadList();
    renderSelected();
    updateMapRoads();
  } catch (error) {
    dom.roadsList.innerHTML = `<div class="empty-state">${error.message}</div>`;
  }
}

function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(reloadRoads, 220);
}

function bindEvents() {
  dom.authButton.addEventListener("click", loginDialogOpen);
  dom.loginForm.addEventListener("submit", handleLogin);
  dom.drawButton.addEventListener("click", startDrawing);
  dom.editButton.addEventListener("click", editSelectedRoad);
  dom.undoPointButton.addEventListener("click", undoPoint);
  dom.cancelButton.addEventListener("click", cancelEditing);
  dom.finishDrawButton.addEventListener("click", finishDrawing);
  dom.roadForm.addEventListener("submit", handleRoadSave);
  dom.searchInput.addEventListener("input", onSearchInput);
  dom.statusFilter.addEventListener("change", reloadRoads);
  dom.centerMapButton.addEventListener("click", () => map?.flyTo({ center: config.center, zoom: config.zoom, duration: 700 }));
  dom.attributionButton.addEventListener("click", () => dom.attributionDialog.showModal());
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      dom.searchInput.focus();
    }
    if (event.key === "Escape" && mode !== "idle") cancelEditing();
    if ((event.key === "Backspace" || event.key === "Delete") && mode !== "idle" && document.activeElement?.tagName !== "INPUT") {
      event.preventDefault();
      undoPoint();
    }
  });
}

async function bootstrap() {
  bindEvents();
  initializeMap();
  await Promise.all([refreshConnection(), refreshUser()]);
  setInterval(refreshConnection, 30000);
}

bootstrap();
