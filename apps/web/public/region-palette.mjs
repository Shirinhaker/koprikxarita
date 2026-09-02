// Viloyat ranglari — 14 ta viloyat uchun 14 ta ajralib turadigan rang.
//
// Qanday tanlangan (qo'lda emas, hisoblab):
//   1. OKLCH fazosida 14 ta rang doira bo'ylab teng taqsimlangan.
//   2. Yorqinlik va to'yinganlik navbatlashtirilgan (L 0.50 / 0.68) —
//      faqat rang tusi bilan farqlash rang ko'rmaslikda yetarli emas.
//   3. Ranglar doira bo'ylab 3 qadam sakratib tartiblangan. Shuning uchun
//      ro'yxatda yonma-yon turgan ikki rang doirada uzoq — ya'ni bir-biriga
//      o'xshamaydi.
//   4. Viloyatlarga g'arbdan sharqqa qarab berilyapti, demak xaritada
//      qo'shni turgan viloyatlar ro'yxatda ham qo'shni bo'ladi va eng
//      farqli ranglarni oladi.
//
// Tekshirilgan (dataviz validator, yorug' rejim, qo'shni juftliklar):
//   rang ko'rmaslik (protanopiya) ΔE 11.4  — talab: >= 8
//   oddiy ko'rish ΔE 20.4                  — talab: >= 15
//   fon bilan kontrast: 7 ta rang 3:1 dan past -> talab bo'yicha
//   "ko'rinadigan yorliq" kerak. Bizda har hududda nomi yozilgan,
//   shuning uchun shart bajarilgan.
export const PROVINCE_COLORS = [
  "#aa3333", // 1
  "#a89b2f", // 2
  "#007d65", // 3
  "#639ae4", // 4
  "#943987", // 5
  "#d5804c", // 6
  "#497200", // 7
  "#00aebd", // 8
  "#5952b7", // 9
  "#d67596", // 10
  "#935200", // 11
  "#52ae73", // 12
  "#006faa", // 13
  "#ae82d4", // 14
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
