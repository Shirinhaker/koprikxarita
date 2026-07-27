function nearestPointOnSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = (dx * dx) + (dy * dy);
  if (lengthSquared === 0) return { x: start.x, y: start.y };
  const raw = (((point.x - start.x) * dx) + ((point.y - start.y) * dy)) / lengthSquared;
  const t = Math.max(0, Math.min(1, raw));
  return { x: start.x + (t * dx), y: start.y + (t * dy) };
}

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return (dx * dx) + (dy * dy);
}

export function snapCoordinateToRoads({
  coordinate,
  roads,
  project,
  unproject,
  tolerancePx = 14,
}) {
  const point = project(coordinate);
  let best = null;

  for (const road of roads) {
    const coordinates = road?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    for (let index = 1; index < coordinates.length; index += 1) {
      const start = project(coordinates[index - 1]);
      const end = project(coordinates[index]);
      const candidate = nearestPointOnSegment(point, start, end);
      const candidateDistance = distanceSquared(point, candidate);
      if (!best || candidateDistance < best.distanceSquared) {
        best = { point: candidate, distanceSquared: candidateDistance, roadId: road.id };
      }
    }
  }

  if (!best || best.distanceSquared > (tolerancePx * tolerancePx)) {
    return { snapped: false, coordinate };
  }

  const lngLat = unproject(best.point);
  const snappedCoordinate = Array.isArray(lngLat)
    ? lngLat
    : [lngLat.lng, lngLat.lat];

  return {
    snapped: true,
    roadId: best.roadId,
    coordinate: snappedCoordinate,
  };
}
