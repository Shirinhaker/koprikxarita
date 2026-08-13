# Binolar qatlami — o‘rnatish

Bu arxiv "Ko‘prik Xarita" loyihasiga binolar qatlami, Esri proyektor,
import va dublikat tozalash imkonini qo‘shadi.

## Qanday o‘rnatiladi

1. Ushbu arxivни oching.
2. Ichidagi papkalarni (`src/`, `apps/`, `scripts/`, `tests/`, `package.json`)
   loyihangiz ildiziga ko‘chiring — mavjud fayllar ustiga yozilsin.
3. Loyiha ildizida tekshiring:
   ```
   npm test
   ```
   `# pass 53` va `# fail 0` chiqsa — hammasi to‘g‘ri joyida.
4. Commit va push:
   ```
   git add .
   git commit -m "Binolar qatlami: Esri proyektor, import va dedup"
   git push
   ```

## Fayllar

YANGI:
- src/domain/buildings.mjs               (bino domeni, validatsiya)
- src/domain/dedup.mjs                    (dublikat aniqlash, IoU)
- src/storage/json-building-repository.mjs (bino saqlash)
- apps/web/public/buildings-app.mjs        (frontend bino boshqaruvi)
- apps/web/public/esri-layer.mjs           (Esri proyektor qatlami)
- apps/web/public/building-style.mjs       (bino uslublari)
- scripts/import-microsoft-buildings.mjs   (Microsoft import)
- scripts/dedup-buildings.mjs              (dublikat tozalash)
- tests/buildings.test.mjs
- tests/building-frontend.test.mjs
- tests/dedup.test.mjs

ALMASHTIRILADI (ustiga yoziladi):
- apps/api/src/server.mjs        (binolar API yo‘nalishlari qo‘shildi)
- apps/web/public/config.js       (Esri sozlamalari)
- apps/web/public/app.js          (binolar moduli ulandi — 3 satr)
- apps/web/public/index.html      (binolar paneli + slider)
- apps/web/public/styles.css      (bino/proyektor uslublari)
- package.json                     (import/dedup buyruqlari)

## Ishlatish

- Server:            npm start   ->  http://localhost:4100  (admin/admin12345)
- Microsoft import:  npm run import-buildings -- --login admin:admin12345 --dry-run --max 200
- Dublikat tozalash: npm run dedup-buildings  -- --login admin:admin12345 --dry-run

`--dry-run` — hech narsa o‘zgartirmasdan sinash. Ishonch hosil qilgach, uni olib tashlang.
