[README.md](https://github.com/user-attachments/files/30370427/README.md)
# Ko‘prik Xarita

**Joriy versiya: BUILD 0002** — OpenStreetMap fon xaritasi ulangan. — BUILD 0001

Surxondaryo viloyati uchun alohida, tahrirlanadigan xarita xizmatining birinchi ishlaydigan prototipi.

## Hozir ishlaydigan imkoniyatlar

- Surxondaryoga markazlangan MapLibre xaritasi.
- Kompyuterda chap panel, telefonda pastki boshqaruv paneli.
- Administrator login orqali kiradi.
- Xarita ustiga bosib ichki ko‘cha chizadi.
- Chizilgan nuqtalarni surib yo‘l shaklini tuzatadi.
- Ko‘cha nomi, turi, qoplamasi, harakat yo‘nalishi, tuman va mahallani kiritadi.
- Ko‘chani draft sifatida saqlaydi, qayta tahrirlaydi, nashr qiladi, arxivlaydi va tiklaydi.
- Oddiy foydalanuvchi faqat nashr qilingan ko‘chalarni ko‘radi.
- Ko‘cha, mahalla va tuman nomi bo‘yicha qidiruv ishlaydi.
- Har bir o‘zgarish alohida jurnal fayliga yoziladi.
- Bir obyektning eski nusxasi bilan tahrirlashga urinish aniqlanadi.

## Ishga tushirish

Kompyuterda Node.js 22 yoki yangiroq versiya kerak.

```bash
npm start
```

Brauzerda oching:

```text
http://localhost:4100
```

Lokal sinov administrator ma’lumotlari:

```text
Login: admin
Parol: admin12345
```

Bu parol faqat lokal prototip uchun. Internetga joylashtirishdan oldin `ADMIN_PASSWORD` va `JWT_SECRET` muhit o‘zgaruvchilarini almashtirish shart.

## Tekshirish

```bash
npm test
npm run check
npm run build
node scripts/smoke-test.mjs
```

## Ma’lumotlar qayerda saqlanadi?

Hozirgi prototip tashqi paket talab qilmasligi uchun:

```text
data/roads.json
data/road-change-log.json
```

fayllarida saqlaydi. Bu mahalliy sinov va interfeysni ishlab chiqish uchun.

`database/migrations/001_init.sql` faylida PostgreSQL + PostGIS uchun tayyor ma’lumotlar bazasi sxemasi mavjud. Serverga joylashtirish bosqichida JSON repository PostGIS repositoryga almashtiriladi.

## Xarita manbasini almashtirish

`apps/web/public/config.js` ichidagi:

```js
mapStyleUrl: "https://demotiles.maplibre.org/style.json"
```

qiymati keyinchalik o‘z serveringizdagi uslub fayliga almashtiriladi. Shu uslub `surxondaryo.pmtiles` manbasiga ulanadi. Ko‘cha tahrirlash logikasi o‘zgarmaydi.

## Muhim cheklov

Ushbu muhit npm registriga ulana olmagani sababli BUILD 0001 hech qanday tashqi paket o‘rnatmasdan ishlaydigan Node.js + oddiy JavaScript prototipi sifatida tayyorlandi. MapLibre brauzerda CDN orqali yuklanadi. React, Terra Draw va to‘liq PostGIS ulanishi keyingi ishlab chiqarish bosqichida qo‘shiladi.
