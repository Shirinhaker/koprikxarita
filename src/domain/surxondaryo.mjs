// Surxondaryo viloyatining chegara qutisi — yagona manba.
//
// Bu qiymat yo'l, bino va hudud tekshiruvlarida ishlatiladi. Avval u
// uchta faylda alohida yozilgan va shimoliy chegarasi 38.7 deb
// ko'rsatilgan edi. Bu xato: viloyatning eng shimoliy tumani
// Sariosiyo 39.04 kenglikgacha cho'ziladi, ya'ni o'sha tumandagi
// har qanday yo'l va bino "viloyatdan tashqarida" degan noto'g'ri
// ogohlantirish olardi.
//
// Quyidagi qiymatlar OpenStreetMap'dan yuklangan 14 ta tumanning
// haqiqiy chegarasidan o'lchangan (2026-09-02):
//   g'arb 66.5002 · janub 37.1816 · sharq 68.4053 · shimol 39.0351
// Ustiga kichik zaxira qo'shilgan — chegara yaqinidagi obyekt va
// OSM'dagi keyingi aniqlashtirishlar noto'g'ri belgilanmasligi uchun.
export const SURXONDARYO_BOUNDS = Object.freeze({
  west: 66.3,
  south: 37.0,
  east: 68.6,
  north: 39.2,
});

export function isPositionInside([lng, lat], bounds = SURXONDARYO_BOUNDS) {
  return lng >= bounds.west && lng <= bounds.east && lat >= bounds.south && lat <= bounds.north;
}
