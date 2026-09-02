// O'zbekiston chegara qutisi — yagona manba.
//
// Loyiha dastlab faqat Surxondaryo uchun edi va chegara uch faylda
// alohida yozilgan, shimoli 38.7 deb ko'rsatilgan edi. Bu ikki marta
// xato bo'lib chiqdi: Surxondaryoning o'zi ham 39.04 gacha cho'ziladi
// (Sariosiyo tumani), keyin esa xarita butun mamlakatga kengaydi.
//
// Quyidagi qiymatlar O'zbekistonning haqiqiy chegarasidan olingan,
// ustiga kichik zaxira qo'shilgan.
export const UZBEKISTAN_BOUNDS = Object.freeze({
  west: 55.9,
  south: 37.1,
  east: 73.2,
  north: 45.7,
});

// Surxondaryo alohida ham kerak bo'lishi mumkin (hisobot, dastlabki
// ko'rinish). OSM'dan yuklangan 14 ta tumandan o'lchangan.
export const SURXONDARYO_BOUNDS = Object.freeze({
  west: 66.3,
  south: 37.0,
  east: 68.6,
  north: 39.2,
});

export function isPositionInside([lng, lat], bounds = UZBEKISTAN_BOUNDS) {
  return lng >= bounds.west && lng <= bounds.east && lat >= bounds.south && lat <= bounds.north;
}

// Ikki chegara qutisi kesishadimi — viewport bo'yicha filtrlashda ishlatiladi.
export function boundsOverlap(a, b) {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

export function parseBbox(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [west, south, east, north] = parts;
  if (west > east || south > north) return null;
  return { west, south, east, north };
}
