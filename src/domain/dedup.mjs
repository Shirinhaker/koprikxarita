// Dublikat aniqlash domeni — Microsoft/OSM/qo‘lda kelgan binolar ustma-ust
// tushganda ularni topib, eng yaxshisini tanlaydi.
//
// Ustma-ustlik IoU (Intersection over Union) bilan o‘lchanadi: ikki poligon
// kesishmasi ularning birlashmasiga nisbati. 1 = to‘liq ustma-ust, 0 = umuman
// tegmaydi. Poligonlar o‘zboshimcha shaklda bo‘lgani uchun IoU union-bbox
// bo‘yicha to‘r nuqtalarini sanash orqali (kutubxonasiz) baholanadi.

export const DEFAULT_IOU_THRESHOLD = 0.5;
export const DEFAULT_GRID_STEPS = 64;

function outerRing(geometry) {
  return geometry?.coordinates?.[0] ?? [];
}
function holes(geometry) {
  return (geometry?.coordinates ?? []).slice(1);
}

export function boundingBox(geometry) {
  const ring = outerRing(geometry);
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, south, east, north };
}

export function centroid(geometry) {
  const ring = outerRing(geometry);
  let x = 0; let y = 0;
  const n = ring.length - 1; // oxirgi nuqta birinchisining takrori
  for (let i = 0; i < n; i += 1) { x += ring[i][0]; y += ring[i][1]; }
  return [x / n, y / n];
}

// Nuqta halqa ichidami — nur (ray casting) usuli.
function pointInRing([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = (yi > py) !== (yj > py)
      && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Nuqta poligon ichidami — tashqi halqada, teshiklardan tashqarida.
export function pointInPolygon(point, geometry) {
  if (!pointInRing(point, outerRing(geometry))) return false;
  for (const hole of holes(geometry)) {
    if (pointInRing(point, hole)) return false;
  }
  return true;
}

function boxesIntersect(a, b) {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

// IoU — union bbox bo‘yicha to‘r nuqtalarini sanab baholanadi.
export function iou(geometryA, geometryB, steps = DEFAULT_GRID_STEPS) {
  const ba = boundingBox(geometryA);
  const bb = boundingBox(geometryB);
  if (!boxesIntersect(ba, bb)) return 0;

  const west = Math.min(ba.west, bb.west);
  const east = Math.max(ba.east, bb.east);
  const south = Math.min(ba.south, bb.south);
  const north = Math.max(ba.north, bb.north);
  const dx = (east - west) / steps;
  const dy = (north - south) / steps;
  if (dx === 0 || dy === 0) return 0;

  let inA = 0; let inB = 0; let inBoth = 0;
  for (let i = 0; i < steps; i += 1) {
    const px = west + (i + 0.5) * dx;
    for (let j = 0; j < steps; j += 1) {
      const py = south + (j + 0.5) * dy;
      const a = pointInPolygon([px, py], geometryA);
      const b = pointInPolygon([px, py], geometryB);
      if (a) inA += 1;
      if (b) inB += 1;
      if (a && b) inBoth += 1;
    }
  }
  const union = inA + inB - inBoth;
  return union === 0 ? 0 : inBoth / union;
}

// ---- Union-Find (guruhlash uchun) ----
class UnionFind {
  constructor(n) { this.parent = Array.from({ length: n }, (_, i) => i); }
  find(x) { while (this.parent[x] !== x) { this.parent[x] = this.parent[this.parent[x]]; x = this.parent[x]; } return x; }
  union(a, b) { this.parent[this.find(a)] = this.find(b); }
}

// Dublikat guruhlarini topish. Bino markazlari bo‘yicha to‘rga bo‘lib,
// faqat yaqin katakchadagilarni solishtirish — katta ro‘yxatlarda tez.
export function findDuplicateGroups(buildings, { threshold = DEFAULT_IOU_THRESHOLD, gridSteps = DEFAULT_GRID_STEPS, cellDeg = 0.003 } = {}) {
  const items = buildings.map((b, index) => ({ index, id: b.id, geometry: b.geometry, box: boundingBox(b.geometry), center: centroid(b.geometry) }));
  const bins = new Map();
  const keyOf = (lng, lat) => `${Math.floor(lng / cellDeg)}:${Math.floor(lat / cellDeg)}`;
  for (const item of items) {
    const key = keyOf(item.center[0], item.center[1]);
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(item);
  }

  const uf = new UnionFind(items.length);
  const comparisons = new Set();
  for (const item of items) {
    const cx = Math.floor(item.center[0] / cellDeg);
    const cy = Math.floor(item.center[1] / cellDeg);
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const neighbors = bins.get(`${cx + ox}:${cy + oy}`);
        if (!neighbors) continue;
        for (const other of neighbors) {
          if (other.index <= item.index) continue;
          const pairKey = `${item.index}-${other.index}`;
          if (comparisons.has(pairKey)) continue;
          comparisons.add(pairKey);
          if (!boxesIntersect(item.box, other.box)) continue;
          if (iou(item.geometry, other.geometry, gridSteps) >= threshold) {
            uf.union(item.index, other.index);
          }
        }
      }
    }
  }

  const groupsMap = new Map();
  for (const item of items) {
    const root = uf.find(item.index);
    if (!groupsMap.has(root)) groupsMap.set(root, []);
    groupsMap.get(root).push(buildings[item.index]);
  }
  // Faqat 2+ a'zoli guruhlar dublikat hisoblanadi.
  return [...groupsMap.values()].filter((group) => group.length > 1);
}

// Guruhdan qaysi bino qoldirilishini tanlash. Ustunlik: nashr qilingan >
// tekshirilgan > qo‘lda > OSM > Microsoft; keyin ishonch, keyin nuqta soni,
// keyin katta maydon.
const statusRank = { published: 3, draft: 2, archived: 1 };
const sourceRank = { manual: 4, osm: 3, microsoft: 2, other: 1 };

export function scoreBuilding(building) {
  return [
    statusRank[building.status] ?? 0,
    building.verified ? 1 : 0,
    sourceRank[building.source] ?? 0,
    building.sourceConfidence ?? 0,
    outerRing(building.geometry).length,
    building.areaSqm ?? 0,
  ];
}

function compareScores(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return b[i] - a[i];
  }
  return 0;
}

export function chooseSurvivor(group) {
  const ranked = [...group].sort((a, b) => compareScores(scoreBuilding(a), scoreBuilding(b)));
  return { survivor: ranked[0], duplicates: ranked.slice(1) };
}

// Butun ro‘yxat uchun dublikat rejasi: qaysi qoladi, qaysilari arxivlanadi.
export function planDeduplication(buildings, options = {}) {
  const groups = findDuplicateGroups(buildings, options);
  const plan = groups.map((group) => {
    const { survivor, duplicates } = chooseSurvivor(group);
    return { survivor, duplicates };
  });
  const totalDuplicates = plan.reduce((sum, item) => sum + item.duplicates.length, 0);
  return { groups: plan, groupCount: plan.length, totalDuplicates };
}
