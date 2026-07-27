import test from "node:test";
import assert from "node:assert/strict";
import { snapCoordinateToRoads } from "../apps/web/public/road-snap.mjs";

const identityProject = ([x, y]) => ({ x, y });
const identityUnproject = ({ x, y }) => [x, y];

const roads = [
  {
    id: "main-road",
    geometry: {
      type: "LineString",
      coordinates: [[0, 0], [10, 0]],
    },
  },
];

test("nuqta mavjud ko‘cha segmentiga yaqin bo‘lsa, aynan segment ustiga yopishadi", () => {
  const result = snapCoordinateToRoads({
    coordinate: [5, 1],
    roads,
    project: identityProject,
    unproject: identityUnproject,
    tolerancePx: 2,
  });

  assert.equal(result.snapped, true);
  assert.equal(result.roadId, "main-road");
  assert.deepEqual(result.coordinate, [5, 0]);
});

test("nuqta ko‘chadan uzoq bo‘lsa, o‘z joyida qoladi", () => {
  const result = snapCoordinateToRoads({
    coordinate: [5, 3],
    roads,
    project: identityProject,
    unproject: identityUnproject,
    tolerancePx: 2,
  });

  assert.equal(result.snapped, false);
  assert.deepEqual(result.coordinate, [5, 3]);
});
