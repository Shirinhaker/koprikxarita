const DEFAULT_OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>';

export function createOsmRasterStyle({
  tileUrl = DEFAULT_OSM_TILE_URL,
  attribution = DEFAULT_OSM_ATTRIBUTION,
} = {}) {
  if (typeof tileUrl !== "string" || !tileUrl.includes("{z}") || !tileUrl.includes("{x}") || !tileUrl.includes("{y}")) {
    throw new TypeError("OSM tile manzili {z}, {x} va {y} qismlarini o‘z ichiga olishi kerak");
  }

  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 19,
        attribution,
      },
    },
    layers: [
      {
        id: "osm-raster",
        type: "raster",
        source: "osm",
        minzoom: 0,
        maxzoom: 22,
        paint: {
          "raster-fade-duration": 0,
        },
      },
    ],
  };
}
