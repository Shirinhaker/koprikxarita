// Viloyat ranglari — 14 ta viloyat uchun 14 ta ajralib turadigan rang.
//
// Qanday tanlangan (qo'lda emas, hisoblab):
//   1. OKLCH fazosida 14 ta rang doira bo'ylab teng taqsimlangan.
//   2. Yorqinlik va to'yinganlik navbatlashtirilgan (L 0.56 / 0.74) —
//      faqat rang tusi bilan farqlash rang ko'rmaslikda yetarli emas.
//   3. Ranglar doira bo'ylab 3 qadam sakratib tartiblangan. Shuning uchun
//      ro'yxatda yonma-yon turgan ikki rang doirada uzoq — ya'ni bir-biriga
//      o'xshamaydi.
//   4. Viloyatlarga g'arbdan sharqqa qarab berilyapti, demak xaritada
//      qo'shni turgan viloyatlar ro'yxatda ham qo'shni bo'ladi va eng
//      farqli ranglarni oladi.
//
// Tekshirilgan (dataviz validator, yorug' rejim, qo'shni juftliklar):
//   rang ko'rmaslik (protanopiya) ΔE 12.0  — talab: >= 8
//   oddiy ko'rish ΔE 21.0                  — talab: >= 15
//   fon bilan kontrast: 7 ta rang 3:1 dan past -> talab bo'yicha
//   "ko'rinadigan yorliq" kerak. Bizda har hududda nomi yozilgan,
//   shuning uchun shart bajarilgan.
//
// Xaritadagi haqiqiy chegaradosh viloyatlar (18 juftlik) bo'yicha
// eng yomon farq: ΔE 22.4. Ranglar ochroq qilinganda bu ko'rsatkich
// 23.7 dan 22.4 ga tushdi — talabdan (15) hamon ancha yuqori.
export const PROVINCE_COLORS = [
  "#ba4b47", // 1
  "#b9ad51", // 2
  "#008e77", // 3
  "#7aadf3", // 4
  "#a54f98", // 5
  "#e59566", // 6
  "#5c8303", // 7
  "#34bfcd", // 8
  "#6966c6", // 9
  "#e68ba9", // 10
  "#a36500", // 11
  "#6dc089", // 12
  "#0081b9", // 13
  "#bf97e3", // 14
];

// Viloyati aniqlanmagan hudud uchun (masalan qo'lda chizilgan, hali
// biriktirilmagan) — betaraf kulrang.
export const NO_PROVINCE_COLOR = "#78716c";

export function provinceColor(colorIndex) {
  if (!Number.isInteger(colorIndex) || colorIndex < 0) return NO_PROVINCE_COLOR;
  return PROVINCE_COLORS[colorIndex % PROVINCE_COLORS.length];
}

// MapLibre uchun data-driven ifoda: har feature'dagi colorIndex xossasiga
// qarab rang tanlaydi. "match" ifodasi "case" zanjiridan tez ishlaydi.
export function colorByProvinceExpression(property = "colorIndex") {
  const branches = [];
  for (const [index, color] of PROVINCE_COLORS.entries()) branches.push(index, color);
  return ["match", ["get", property], ...branches, NO_PROVINCE_COLOR];
}
