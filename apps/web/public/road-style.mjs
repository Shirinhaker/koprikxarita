export const ROAD_CASING_COLOR = "#d0d2d4";
export const ROAD_FILL_COLOR = "#ffffff";

const casingWidth = [
  "interpolate", ["exponential", 1.55], ["zoom"],
  10, 0.7, 12, 1.4, 14, 2.8, 16, 5, 18, 8.2, 20, 11.5,
];

const fillWidth = [
  "interpolate", ["exponential", 1.55], ["zoom"],
  10, 0.35, 12, 0.8, 14, 1.8, 16, 3.5, 18, 6.2, 20, 8.8,
];

const zoomOpacity = [
  "interpolate", ["linear"], ["zoom"], 10, 0, 11, 0.72, 12, 1,
];

const roadLayout = {
  "line-cap": "round",
  "line-join": "round",
};

export function createSavedRoadLayers({ source = "roads-source" } = {}) {
  return [
    {
      id: "roads-casing",
      type: "line",
      source,
      minzoom: 10,
      layout: roadLayout,
      paint: {
        "line-color": ROAD_CASING_COLOR,
        "line-width": casingWidth,
        "line-opacity": zoomOpacity,
      },
    },
    {
      id: "roads-fill",
      type: "line",
      source,
      minzoom: 10,
      layout: roadLayout,
      paint: {
        "line-color": ROAD_FILL_COLOR,
        "line-width": fillWidth,
        "line-opacity": zoomOpacity,
      },
    },
  ];
}

export function createDraftRoadLayers({ source = "draft-source" } = {}) {
  return [
    {
      id: "draft-casing",
      type: "line",
      source,
      minzoom: 10,
      filter: ["==", ["get", "kind"], "line"],
      layout: roadLayout,
      paint: {
        "line-color": ROAD_CASING_COLOR,
        "line-width": casingWidth,
        "line-opacity": zoomOpacity,
      },
    },
    {
      id: "draft-fill",
      type: "line",
      source,
      minzoom: 10,
      filter: ["==", ["get", "kind"], "line"],
      layout: roadLayout,
      paint: {
        "line-color": ROAD_FILL_COLOR,
        "line-width": fillWidth,
        "line-opacity": zoomOpacity,
      },
    },
    {
      id: "draft-points",
      type: "circle",
      source,
      minzoom: 12,
      filter: ["==", ["get", "kind"], "point"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2.5, 18, 4],
        "circle-color": ROAD_FILL_COLOR,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": ROAD_CASING_COLOR,
      },
    },
  ];
}
