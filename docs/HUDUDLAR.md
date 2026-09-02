# Hududlar — davlat, viloyat, tuman, mahalla

Xaritada butun O'zbekiston ko'rsatiladi. Qo'shni davlatlar niqob bilan
yopilgan — diqqat mamlakatda qoladi. Har viloyat **o'z rangiga** ega,
uning tumanlari shu rangni meros qiladi.

Uzoqdan faqat viloyat chegaralari ko'rinadi. Yaqinlashtirilganda
(zoom 8 dan) tumanlar qo'shiladi va viloyat chizig'i xiralashadi.

| Daraja | Ko'rinishi | Manba |
|---|---|---|
| **Davlat** | tashqarisini yopadigan niqob | OSM `admin_level=2` |
| **Viloyat** | qalin uzun uzuq chiziq, o'z rangi | OSM `admin_level=3/4` — 14 ta |
| **Tuman** | ingichkaroq, viloyat rangida | OSM `admin_level=6/7` — 206 ta |
| **Mahalla** | eng ingichka | qo'lda chiziladi (OSM'da yo'q) |

Qoraqalpog'iston `admin_level=3` (avtonom respublika), qolgan 13 tasi
`admin_level=4`. Shuning uchun ular bitta so'rov bilan topilmaydi va
ro'yxat skriptda qo'lda yozilgan.

## Nega ikki bosqichli yuklash

206 ta tumanning geometriyasi **~1.9 MB**. Uni sahifa ochilishida
yuklash sekin va bekorga. Shuning uchun:

```
sahifa ochilganda   davlat konturi + 14 viloyat   ~0.16 MB
zoom >= 8 bo'lganda  ko'rinayotgan hududdagi tumanlar   ~0.10-0.20 MB
```

Tuman so'rovi xarita surilganda takrorlanadi, lekin 350 ms kutib
(har piksel siljishda so'rov ketmasligi uchun) va oxirgi so'ralgan
hudud eslab qolinadi — bir joyda turganda takroriy so'rov yo'q.

**Muhim:** bu `bbox` haqiqiy API parametri:

```
GET /api/regions?level=tuman&bbox=60.0,40.9,61.5,42.0
```

Binolar qatlamidagi `__viewport__:...` kabi qidiruv matniga yashirilgan
hiyla emas. Buzuq `bbox` jimgina butun ro'yxatni qaytarmaydi — 422 xato
beradi, aks holda mijoz sezmasdan megabaytlab ma'lumot yuklab olardi.

## Ranglar qanday tanlangan

Qo'lda emas, hisoblab. `apps/web/public/region-palette.mjs`:

1. OKLCH fazosida 14 ta rang doira bo'ylab teng taqsimlangan
2. Yorqinlik va to'yinganlik navbatlashtirilgan (faqat rang tusi bilan
   farqlash rang ko'rmaslikda yetarli emas)
3. Ranglar doira bo'ylab **3 qadam sakratib** tartiblangan — ro'yxatda
   yonma-yon turgan ikki rang doirada uzoq
4. Viloyatlarga **haqiqiy chegaradoshlik grafi bo'yicha** berilgan

4-qadam haqida alohida. Avval ranglar oddiy g'arbdan-sharqqa tartibda
berilgandi. Tekshirib ko'rilganda **Jizzax va Navoiy** chegaradosh
chiqdi va ranglari deyarli bir xil edi (ΔE 10.4, talab 15).

Shuning uchun viloyatlarning haqiqiy chegaradoshligi geometriyadan
hisoblab chiqildi (**18 ta chegaradosh juftlik**) va ranglar shu graf
bo'yicha optimallashtirildi. Natija `scripts/import-osm-regions.mjs`
dagi `PROVINCES` ro'yxatiga `colorIndex` sifatida qotirilgan.

Tekshiruv natijasi:

```
palitraning o'zi (dataviz validator, qo'shni juftliklar):
  rang ko'rmaslik (protanopiya)   ΔE 11.4   talab: >= 8
  oddiy ko'rish                   ΔE 20.4   talab: >= 15

xaritadagi haqiqiy chegaradosh viloyatlar:
  eng yaqin rang                  ΔE 23.7   talab: >= 15
  (optimallashtirishdan oldin: 10.4)
```

**Viloyat qo'shilsa yoki chegara o'zgarsa** bu raqamlarni qayta hisoblash
kerak: viloyatlarni yuklab, har juftlik uchun chegaradoshlikni aniqlab
(nuqtalari ~2 km dan yaqin bo'lsa chegaradosh), keyin rang raqamlarini
almashtirib eng yomon ΔE ni maksimallashtirish.

Fon bilan kontrast 7 ta rangda 3:1 dan past. Qoida bunday holda
"ko'rinadigan yorliq" talab qiladi — bizda har hududda nomi yozilgan,
shart bajarilgan.

## Yuklash

```bash
# Sinash — serverga hech narsa yozilmaydi
npm run import-regions -- --login admin:PAROL --dry-run

# To'liq yuklash (davlat + 14 viloyat + 206 tuman)
npm run import-regions -- --login admin:PAROL

# Jonli saytga
npm run import-regions -- --api https://SIZNING-MANZIL/api --login admin:PAROL
```

### Bayroqlar

| Bayroq | Ma'nosi |
|---|---|
| `--login user:parol` | avval login qiladi va token oladi |
| `--token <token>` | tayyor token bilan |
| `--api <manzil>` | standart: `http://localhost:4100/api` |
| `--only Surxondaryo,Buxoro` | faqat shu viloyatlar |
| `--skip-districts` | faqat viloyat chegaralari |
| `--tolerance-viloyat 0.004` | viloyat soddalashtirilishi (~400 m) |
| `--tolerance-tuman 0.0008` | tuman soddalashtirilishi (~80 m) |
| `--out fayl.geojson` | natijani faylga ham yozadi |
| `--dry-run` | serverga yozmaydi |

### Overpass sekin ishlashi — bu normal

OpenStreetMap so'rovlari **Overpass API** orqali olinadi. Bu bepul ochiq
xizmat va band paytda `504` yoki `500` qaytaradi. Skript uchta oynani
navbat bilan sinaydi va kutish vaqtini oshirib qayta uradi.

To'liq import **bir soatgacha** cho'zilishi mumkin. Bu kodning emas,
Overpass'ning sekinligi.

Import **takroriy ishga tushirilishi mumkin va xavfsiz**: hudud OSM
identifikatori (`relation/196248`) bo'yicha topiladi va yangilanadi,
dublikat yaratilmaydi. Ya'ni yarim yo'lda uzilib qolsa — buyruqni
qaytadan berish yetarli, boshidan boshlamaydi.

Bitta viloyat tushib qolsa, uni alohida yuklash mumkin:

```bash
npm run import-regions -- --login admin:PAROL --only Namangan
```

## API

| Metod | Manzil | Kim |
|---|---|---|
| `GET` | `/api/regions?level=davlat` | hamma |
| `GET` | `/api/regions?level=viloyat` | hamma |
| `GET` | `/api/regions?level=tuman&bbox=w,s,e,n` | hamma |
| `POST` | `/api/regions` · `/import` | administrator |
| `PUT` · `DELETE` | `/api/regions/:id` | administrator |
| `POST` | `/api/regions/:id/publish` · `/restore` | administrator |

Javobda uchta narsa: `regions` (ro'yxat), `geojson` (chizish uchun) va
`labels` (nomlarni qo'yish uchun nuqtalar).

Parametrlar: `level`, `bbox`, `limit`, `status` (oxirgisi faqat
administratorga ta'sir qiladi — oddiy foydalanuvchi doim nashr
qilinganini oladi).

## Ierarxiya qoidalari

```
davlat  -> yuqori hududsiz
viloyat -> yuqori hududsiz (davlat bitta, biriktirish ortiqcha)
tuman   -> viloyat SHART
mahalla -> tuman SHART
```

Tuman viloyatsiz, mahalla tumansiz saqlanmaydi — aks holda ular
"egasiz" qolib, qidiruvda va hisobotlarda yo'qoladi.

## Ma'lumot fayllari

```text
data/regions.json             hududlar
data/region-change-log.json   o'zgarishlar jurnali
```

`REGIONS_FILE` va `REGION_LOG_FILE` bilan almashtiriladi. Railway'da
yo'llar bilan bir papkada — doimiy diskda.

Jurnalda geometriya to'liq saqlanmaydi, faqat nuqtalar soni: aks holda
har o'zgarishda jurnal yuz minglab koordinata bilan to'lardi.

## Chegara tekshiruvi

Yo'l va bino `src/domain/uzbekiston.mjs` dagi qutiga solishtiriladi.
Loyiha Surxondaryodan butun mamlakatga kengaygani uchun bu quti endi
O'zbekistonniki. Surxondaryo chegarasi ham shu faylda qoldi.

Tarixi: chegara avval uch faylda alohida yozilgan va shimoli `38.7` deb
ko'rsatilgan edi. Bu xato — Surxondaryoning o'zi ham Sariosiyo tumani
orqali `39.04` gacha cho'ziladi. Endi qiymat bir joyda.
