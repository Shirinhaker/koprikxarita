# Hududlar — tuman va mahalla chegaralari

Xaritada ma'muriy chegaralar ko'rsatiladi: tuman qalinroq binafsha uzuq
chiziq bilan, mahalla ingichkaroq g'ishtrang chiziq bilan. Chegaralar
yo'l va bino qatlamlari **ostida** turadi — ular fon ma'lumoti, asosiy
mazmunni bekitmasligi kerak.

Chap paneldagi "Hududlar" bo'limidan qatlamni yoqib-o'chirish mumkin.
Hudud ustiga bosilsa nomi va darajasi chiqadi.

## Ma'lumot qayerdan keladi

| Daraja | Manba | Holat |
|---|---|---|
| **Tuman** | OpenStreetMap (`admin_level=6`) | 14 tasi ham to'liq mavjud |
| **Mahalla** | qo'lda chiziladi | OSM'da Surxondaryo bo'yicha atigi 3 ta bor |

Shuning uchun tumanlar avtomatik yuklanadi, mahalla esa administrator
tomonidan chiziladi. Ma'lumot tuzilmasi ikkalasini ham qo'llaydi.

## Tumanlarni yuklash

```bash
# Avval sinash — serverga hech narsa yozilmaydi
npm run import-regions -- --login admin:PAROL --dry-run

# Haqiqiy yuklash
npm run import-regions -- --login admin:PAROL
```

Serverda (Railway) ishlatish uchun `--api` bilan manzil ko'rsatiladi:

```bash
npm run import-regions -- --api https://SIZNING-MANZIL/api --login admin:PAROL
```

Import **takroriy ishga tushirilishi mumkin**: hudud OSM identifikatori
(`relation/11180683`) bo'yicha topiladi va yangilanadi, dublikat
yaratilmaydi. OSM'da chegara aniqlashtirilsa, importni qayta ishga
tushirish yetarli.

### Bayroqlar

| Bayroq | Ma'nosi |
|---|---|
| `--login user:parol` | avval login qiladi va token oladi |
| `--token <token>` | tayyor token bilan |
| `--api <manzil>` | standart: `http://localhost:4100/api` |
| `--tolerance 0.0002` | geometriyani soddalashtirish (daraja). `0` — soddalashtirmaslik |
| `--out fayl.geojson` | yuklangan chegaralarni faylga ham yozadi |
| `--dry-run` | serverga yozmaydi, faqat ko'rsatadi |

Soddalashtirish nima uchun kerak: rasmiy chegarada nuqta juda ko'p
(masalan Qumqo'rg'on — 4018 ta). Viloyat masshtabida bu detal ko'zga
ko'rinmaydi, lekin faylni og'irlashtiradi. Standart `0.0002` daraja
(~20 metr) nuqtalar sonini taxminan ikki barobar kamaytiradi va
ko'rinishga ta'sir qilmaydi.

### Overpass haqida

OpenStreetMap so'rovlari **Overpass API** orqali olinadi. Bu bepul ochiq
xizmat va so'rovni cheklab qo'yishi odatiy hol. Skript uchta oynani
navbat bilan sinaydi va kutish vaqtini oshirib qayta uradi — birinchi
urinish muvaffaqiyatsiz bo'lsa, xabar chiqadi va o'zi davom etadi.

## API

| Metod | Manzil | Kim |
|---|---|---|
| `GET` | `/api/regions?level=tuman` | hamma (faqat nashr qilinganini ko'radi) |
| `POST` | `/api/regions` | administrator |
| `POST` | `/api/regions/import` | administrator |
| `PUT` | `/api/regions/:id` | administrator |
| `DELETE` | `/api/regions/:id` | administrator (arxivlaydi) |
| `POST` | `/api/regions/:id/publish` · `/restore` | administrator |

`GET /api/regions` javobida uchta narsa qaytadi: `regions` (ro'yxat),
`geojson` (chizish uchun) va `labels` (nomlarni qo'yish uchun nuqtalar).

## Ma'lumot fayllari

```text
data/regions.json             hududlar
data/region-change-log.json   o'zgarishlar jurnali
```

Manzillarni `REGIONS_FILE` va `REGION_LOG_FILE` muhit o'zgaruvchilari
bilan almashtirish mumkin. Railway'da ular yo'llar bilan bir papkada —
doimiy diskda — saqlanadi.

Jurnalda geometriya to'liq saqlanmaydi, faqat nuqtalar soni yoziladi:
aks holda har o'zgarishda jurnal fayli yuz minglab koordinata bilan
to'lib ketardi.

## Yo'l-yo'lakay tuzatilgan nosozlik

Viloyat chegara qutisi uch faylda alohida yozilgan va shimoliy chegarasi
`38.7` deb ko'rsatilgan edi. Bu xato: eng shimoliy tuman **Sariosiyo**
`39.04` kenglikkacha cho'ziladi. Ya'ni o'sha tumandagi har qanday yo'l
va bino "Surxondaryo chegarasidan tashqarida bo'lishi mumkin" degan
noto'g'ri ogohlantirish olardi.

Endi chegara `src/domain/surxondaryo.mjs` da bir joyda turadi va
qiymatlar OSM'dan yuklangan 14 ta tumanning haqiqiy chegarasidan
o'lchangan.
