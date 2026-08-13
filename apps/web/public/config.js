window.KOPRIK_CONFIG = {
  apiBase: "/api",
  osmTileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  mapAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
  // Esri "proyektor" — tekshirish/orientir uchun xira sun'iy yo'ldosh foni.
  esriTileUrl: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  esriAttribution: "Tasvir: &copy; Esri, Maxar, Earthstar Geographics va GIS jamoasi",
  esriOpacity: 0.35,
  center: [67.27, 37.94],
  zoom: 8,
  projectName: "Ko‘prik Xarita"
};

import("/microsoft-import-panel.mjs?build=0006").catch((error) => {
  console.error("Microsoft binolar import paneli yuklanmadi:", error);
});
