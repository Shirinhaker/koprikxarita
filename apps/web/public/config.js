window.KOPRIK_CONFIG = {
  apiBase: "/api",
  osmTileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  mapAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
  esriTileUrl: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  esriAttribution: "Tasvir: &copy; Esri, Maxar, Earthstar Geographics va GIS jamoasi",
  esriOpacity: 0.35,
  center: [67.27, 37.94],
  zoom: 8,
  projectName: "Ko‘prik Xarita"
};

// BUILD 0007: MapLibre obyektini ushlab qolamiz. Asosiy app.js o‘zgarmaydi.
(() => {
  let maplibreValue;
  let observedMap = null;
  let reloadTimer = null;
  const originalFetch = window.fetch.bind(window);

  const triggerBuildingReload = () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      document.querySelector("#buildingStatusFilter")
        ?.dispatchEvent(new Event("change", { bubbles: true }));
    }, 180);
  };

  Object.defineProperty(window, "maplibregl", {
    configurable: true,
    get() { return maplibreValue; },
    set(value) {
      if (value?.Map && !value.Map.__koprikObserved) {
        const OriginalMap = value.Map;
        const ObservedMap = new Proxy(OriginalMap, {
          construct(Target, args, NewTarget) {
            const instance = Reflect.construct(Target, args, NewTarget);
            observedMap = instance;
            window.__KOPRIK_MAP__ = instance;
            instance.on?.("moveend", triggerBuildingReload);
            return instance;
          },
        });
        Object.defineProperty(ObservedMap, "__koprikObserved", { value: true });
        value.Map = ObservedMap;
      }
      maplibreValue = value;
    },
  });

  window.fetch = (input, init = {}) => {
    const rawUrl = typeof input === "string" ? input : input?.url;
    const method = String(init.method ?? "GET").toUpperCase();
    if (rawUrl && method === "GET" && observedMap) {
      const url = new URL(rawUrl, window.location.origin);
      if (url.origin === window.location.origin && url.pathname === "/api/buildings") {
        if (observedMap.getZoom() < 12) {
          return Promise.resolve(new Response(JSON.stringify({
            buildings: [],
            geojson: { type: "FeatureCollection", features: [] },
          }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          }));
        }
        const b = observedMap.getBounds();
        const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
          .map((value) => Number(value.toFixed(6)));
        const status = url.searchParams.get("status") ?? "published";
        const q = `__viewport__:${bbox.join(",")};6000`;
        const replacement = `/api/buildings/search?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`;
        return originalFetch(replacement, init);
      }
    }
    return originalFetch(input, init);
  };
})();

import("/microsoft-import-panel.mjs?build=0007").catch((error) => {
  console.error("Microsoft binolar import paneli yuklanmadi:", error);
});
