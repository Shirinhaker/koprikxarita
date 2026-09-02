# Qatlamlarni tozalash rejasi

**Sana:** 2026-09-02
**Holat:** taklif — bajarilmagan
**Sabab:** BUILD 0005–0007 davomida yangi imkoniyatlar mavjud kodni tuzatish
o'rniga uni *o'rab* qo'shildi. Ishlaydi, lekin har yangi qatlam keyingisini
qiyinlashtiradi va nosozlikni topishni murakkablashtiradi.

## Hozirgi zanjir

Backend:

```
package.json "start"
  -> apps/api/src/start-0005.mjs      alohida jarayon ochadi (spawn)
       -> apps/api/src/server-0005.mjs  createKoprikServer() chaqiradi,
                                        lekin uni tinglashga qo'ymaydi —
                                        faqat request handler'ini "o'g'irlaydi"
            -> apps/api/src/server.mjs  asl server
```

Frontend:

```
index.html
  -> config.js      sozlamalar + window.fetch almashtirish
                    + maplibregl.Map Proxy bilan o'rash
                    + microsoft-import-panel.mjs ni dinamik import qilish
  -> app.js              yo'llar (BUILD 0004 dan beri tegilmagan)
  -> buildings-app.mjs   binolar
```

---

## Muammolar

### B1 — Ikki jarayon, sababsiz
`start-0005.mjs` faqat `server-0005.mjs` ni `spawn` qiladi va signallarni
qo'lda uzatadi. Railway'da bitta konteynerda ikkita Node jarayoni ishlaydi.
SIGTERM uzatish qo'lda yozilgan — deploy paytida to'g'ri to'xtamaslik xavfi bor.

**Yechim:** bitta kirish nuqtasi. Avtomatik import mantiqi (`MICROSOFT_AUTO_IMPORT`)
server ishga tushgach o'sha jarayonning o'zida chaqirilsin.

### B2 — Serverni o'rab olish
`server-0005.mjs:202` da:

```js
const baseServer = createKoprikServer({...});
const [baseRequestHandler] = baseServer.listeners("request");
```

To'liq `http.Server` yaratilib, undan faqat bitta funksiya olinadi; server
obyektining o'zi tashlab yuboriladi.

**Yechim:** `server.mjs` da `createKoprikRequestHandler()` eksport qilinsin
(sof funksiya), `createKoprikServer()` esa uni `http.createServer()` ga
o'rasin. Import yo'nalishlari `server.mjs` ichidagi yo'nalishlar ro'yxatiga
oddiy qo'shilsin.

### B3 — Import holati stdout'dan regex bilan o'qiladi
`server-0005.mjs:117`:

```js
const finalMatch = /Tayyor\.\s*(\d+)\s*ta bino\s*import qilindi/.exec(text);
```

Import skripti alohida jarayon sifatida ishga tushiriladi va uning **matnli
chiqishi** regex bilan tahlil qilinib, progress hisoblanadi. Log matnidagi
bitta so'z o'zgarsa — progress ko'rsatkichi buziladi, xato esa sezilmaydi.

**Yechim:** import skripti har qadamda bir qator JSON yozsin
(`{"event":"progress","imported":120,"tile":3,"totalTiles":48}`), server esa
qatorlarni `JSON.parse` qilsin. Yoki import funksiyasi to'g'ridan-to'g'ri
chaqirilsin (`import { runImport } from ...`), jarayon ochilmasin.

### B4 — Parol va secret uchun standart qiymatlar kodda
`server-0005.mjs`:

```js
password: process.env.ADMIN_PASSWORD ?? "admin12345"
const jwtSecret = process.env.JWT_SECRET ?? "development-only-secret-change-me"
```

Hozir Railway'da bu o'zgaruvchilar **o'rnatilgan**, shuning uchun bevosita xavf
yo'q. Lekin o'zgaruvchi tasodifan o'chirilsa yoki yangi muhit ochilsa, sayt
ma'lum parol bilan ishlab ketadi va buni hech kim sezmaydi.

**Yechim:** `NODE_ENV=production` bo'lganda `ADMIN_PASSWORD` yoki `JWT_SECRET`
bo'lmasa, server aniq xato matni bilan **ishga tushmasin**. Standart qiymatlar
faqat development uchun qolsin.

### B5 — Fayl nomlarida versiya raqami
`server-0005.mjs`, `start-0005.mjs` — kod esa BUILD 0007. Fayl nomi bilan
haqiqiy versiya mos emas. Har yangi BUILD `-0008`, `-0009` fayl qo'shsa,
qaysi biri ishlayotganini faqat `package.json` dan bilib olish mumkin.

**Yechim:** B1 va B2 bajarilgach bu fayllar yo'qoladi. Versiya faqat
`package.json` va `BUILD.md` da qolsin.

### F1 — `config.js` sozlama fayli emas, kod yamog'i
`config.js` ichida:
- `window.fetch` butunlay almashtiriladi va `/api/buildings` so'rovlari
  boshqa manzilga yo'naltiriladi;
- `window.maplibregl` uchun `Object.defineProperty` setter qo'yilib,
  `maplibregl.Map` `Proxy` bilan o'raladi;
- `microsoft-import-panel.mjs` dinamik import qilinadi.

Kodda izoh ochiq yozilgan: *"Asosiy app.js o'zgarmaydi"*. Ya'ni bu qatlamning
mavjud bo'lish sababi — asl faylga tegmaslik.

**Yechim:**
- Viewport bo'yicha yuklash mantiqi `buildings-app.mjs` ichiga ko'chsin —
  u allaqachon xarita obyektiga ega, `fetch` ni almashtirish shart emas.
- Panel `index.html` da oddiy `<script type="module">` bilan ulansin.
- `config.js` faqat `window.KOPRIK_CONFIG` qoldirsin.

### F2 — Viewport so'rovi qidiruv maydoniga yashirilgan
`json-building-repository.mjs:21`:

```js
const viewport = (q) => { const t=String(q??""); if(!t.startsWith("__viewport__:")) return null; ... };
```

Xarita ko'rinayotgan hudud koordinatalari `__viewport__:67.1,37.8,67.4,38.0;6000`
ko'rinishida **qidiruv matni** sifatida uzatiladi va saqlash qatlamida
tahlil qilinadi. Bundan tashqari bu qator siqilgan, bir satrli — loyihaning
qolgan kodidan uslub jihatidan keskin farq qiladi.

**Yechim:** API'ga haqiqiy parametr qo'shilsin:
`GET /api/buildings?bbox=west,south,east,north&limit=6000`. Saqlash qatlami
matn tahlil qilmasin, tayyor `bbox` obyektini qabul qilsin.

### D1 — Hujjatlar eskirgan
`README.md` va `BUILD.md` ning birinchi qatorida tasodifan qo'shilgan
GitHub havolasi bor (`[README.md](https://github.com/user-attachments/...)`),
ikkalasi ham "Joriy versiya: BUILD 0003" deb yozadi — kod esa BUILD 0007.

**Yechim:** havolalar o'chirilsin, versiya BUILD 0007 ga yangilansin,
0004–0007 o'zgarishlari `BUILD.md` ga qo'shilsin.

---

## Bajarish tartibi

Har qadamdan keyin `npm test` va `npm run check` yashil bo'lishi shart.
Har qadam alohida PR — bittasi buzilsa, qolganiga ta'sir qilmasin.

| № | Qadam | Nima o'zgaradi | Xavf |
|---|---|---|---|
| 1 | **D1** — hujjatlarni yangilash | faqat `.md` fayllar | yo'q |
| 2 | **B4** — production'da secret majburiy | `server-0005.mjs` | past — Railway'da o'zgaruvchilar bor |
| 3 | **F2** — `bbox` parametri | API + saqlash qatlami + frontend | o'rta |
| 4 | **F1** — `config.js` tozalash | `config.js`, `buildings-app.mjs`, `index.html` | o'rta |
| 5 | **B2** — request handler eksporti | `server.mjs`, `server-0005.mjs` | o'rta |
| 6 | **B1 + B5** — bitta kirish nuqtasi | `start-0005.mjs` o'chadi, `package.json` | o'rta |
| 7 | **B3** — import progressi JSON orqali | import skripti + manager | o'rta |

**Muhim:** 3-qadamdan boshlab har PR merge bo'lgach Railway avtomatik qayta
deploy qiladi. Merge'dan keyin saytni ochib tekshirish kerak: xarita
ko'rinadimi, ko'chalar chiziladimi, binolar chiqadimi, admin kira oladimi.

## Qabul mezoni (hammasi tugagach)

- `package.json` `start` bitta faylga ishora qiladi va u jarayon ochmaydi
- Kodda `-0005` qo'shimchali fayl qolmaydi
- `config.js` ichida `window.fetch` ga ham, `maplibregl` ga ham tegilmaydi
- `__viewport__` qatori kodda umuman uchramaydi
- `NODE_ENV=production` va `JWT_SECRET` yo'q bo'lsa server ishga tushmaydi
- `npm test` — barcha testlar o'tadi, hech biri `skip` yoki `todo` emas
- Sayt avvalgidek ishlaydi: kirish, ko'cha chizish, bino importi
