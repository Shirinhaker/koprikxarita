# Ko‘prik Xarita — birinchi versiya dizayni

Sana: 2026-07-23
Holat: foydalanuvchi tomonidan tasdiqlangan

## 1. Maqsad

Ko‘prik/Platforma loyihasidan mustaqil ishlaydigan, Surxondaryo viloyati uchun tahrirlanadigan xarita xizmatining birinchi versiyasini yaratish.

Birinchi versiyada administrator xaritada ichki ko‘chalarni qo‘lda chizadi, nomlaydi, xususiyatlarini belgilaydi, saqlaydi, keyin tahrirlaydi yoki o‘chiradi. Oddiy foydalanuvchi tasdiqlangan ko‘chalarni ko‘radi va qidiradi.

## 2. Birinchi versiya doirasi

### Kiritiladi

- Surxondaryo hududiga markazlangan MapLibre xaritasi.
- Kompyuter va telefon ekranlariga mos interfeys.
- Administrator kirishi.
- Ko‘cha chizish, nuqtalarni surib tuzatish va chizishni bekor qilish.
- Ko‘cha nomi, yo‘l turi, qoplama turi, harakat yo‘nalishi va holatini belgilash.
- Chizilgan ko‘chani saqlash, tahrirlash va o‘chirish.
- Tasdiqlangan ko‘chalarni oddiy foydalanuvchilarga ko‘rsatish.
- Ko‘cha nomi bo‘yicha qidiruv.
- Har bir o‘zgarish uchun yaratuvchi va vaqtni saqlash.
- OpenStreetMap ma’lumotidan foydalanilganda zarur manba ko‘rsatmasini ixcham axborot oynasida berish.

### Keyingi bosqichga qoldiriladi

- Avtomobil navigatsiyasi va ovozli yo‘l-yo‘riq.
- Tirbandlik ma’lumotlari.
- Sun’iy yo‘ldosh tasvirlari.
- Ko‘cha panoramalari.
- Ommaviy foydalanuvchilarning to‘g‘ridan-to‘g‘ri tahriri.
- Mobil ilova; birinchi versiya responsiv web ilova bo‘ladi.
- Ko‘prik/Platforma bilan integratsiya.

## 3. Tavsiya etilgan yechim

### Frontend

- React + TypeScript + Vite.
- MapLibre GL JS — xarita ko‘rsatish.
- Terra Draw — geometriya chizish va tahrirlash.
- PMTiles protokoli — keyinchalik o‘z xarita faylini serverdan o‘qish.
- Mobil ekranda tahrirlash vositalari pastki panelda, kompyuterda chap yon panelda joylashadi.

### Backend

- Node.js + TypeScript + Express.
- REST API.
- Administrator autentifikatsiyasi uchun xavfsiz sessiya yoki token.
- Kiruvchi geometriyani serverda tekshirish.

### Ma’lumotlar bazasi

- PostgreSQL + PostGIS.
- Yo‘l geometriyasi `LINESTRING` sifatida saqlanadi.
- Birinchi versiyada PostGIS keyingi masofa, hudud va marshrut hisoblari uchun tayyor asos beradi.

### Xarita ma’lumoti

Ishlab chiqish paytida vaqtinchalik fon xaritasi ishlatiladi. Ishlab chiqarish muhitida Surxondaryo uchun tayyorlangan `surxondaryo.pmtiles` fayli alohida statik fayl serveri yoki obyekt saqlash xizmatidan beriladi.

## 4. Asosiy ekranlar

### 4.1. Umumiy xarita

- Yuqorida qidiruv.
- Asosiy qismda xarita.
- Ko‘cha tanlanganda nomi va asosiy ma’lumotlari ko‘rsatiladi.
- Oddiy foydalanuvchi faqat tasdiqlangan obyektlarni ko‘radi.

### 4.2. Administrator xarita tahrirlash oynasi

Kompyuterda chap panel:

- Ko‘cha chizish.
- Tanlangan ko‘chani tahrirlash.
- O‘chirish.
- Saqlash yoki bekor qilish.
- Ko‘cha ma’lumotlari formasi.

Telefon ekranida shu vositalar pastki ochiladigan panelga yig‘iladi.

### 4.3. Tasdiqlashlar

Birinchi versiyada faqat administrator tahrir qilgani uchun alohida murakkab moderatsiya oqimi shart emas. Biroq har bir yo‘l `draft`, `published` yoki `archived` holatiga ega bo‘ladi. Bu keyinchalik muharrir rollarini qo‘shishga tayyorlaydi.

## 5. Ma’lumotlar modeli

### users

- id
- full_name
- email yoki login
- password_hash
- role: `admin`, `viewer`
- created_at
- updated_at

### roads

- id
- name
- road_type: `residential`, `service`, `pedestrian`, `track`, `other`
- surface: `asphalt`, `concrete`, `gravel`, `ground`, `unknown`
- direction: `two_way`, `one_way`
- status: `draft`, `published`, `archived`
- geometry: PostGIS `LINESTRING`, SRID 4326
- district_name
- neighborhood_name
- created_by
- created_at
- updated_at

### road_change_log

- id
- road_id
- action: `create`, `update`, `delete`, `publish`
- old_data
- new_data
- changed_by
- changed_at

O‘chirish odatda fizik o‘chirish emas, `archived` holatiga o‘tkazish orqali bajariladi. Bu xatoni qaytarish imkonini beradi.

## 6. API chegaralari

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/roads?status=published`
- `GET /api/roads/:id`
- `POST /api/roads`
- `PUT /api/roads/:id`
- `DELETE /api/roads/:id`
- `POST /api/roads/:id/publish`
- `GET /api/roads/search?q=...`

Oddiy foydalanuvchi yozish API’lariga kira olmaydi. Barcha yozish so‘rovlari server tomonidan rol bo‘yicha tekshiriladi.

## 7. Ma’lumot oqimi

1. Frontend xarita fonini PMTiles yoki vaqtinchalik rivojlantirish manbasidan yuklaydi.
2. Frontend `GET /api/roads` orqali saqlangan ko‘chalarni GeoJSON ko‘rinishida oladi.
3. Administrator Terra Draw orqali yangi `LineString` chizadi.
4. Forma ma’lumotlari va geometriya backendga yuboriladi.
5. Backend koordinatalar va maydonlarni tekshiradi.
6. PostGIS bazasiga yozadi va o‘zgarish jurnalini yaratadi.
7. Frontend yangi obyektni qayta yuklamasdan xaritada ko‘rsatadi.

## 8. Tekshiruv va xatolarni boshqarish

- Kamida ikki nuqtadan iborat bo‘lmagan yo‘l saqlanmaydi.
- Surxondaryo chegarasidan tashqaridagi geometriya haqida ogohlantirish beriladi.
- Nomsiz ko‘chaga vaqtinchalik nom bilan saqlashga ruxsat beriladi, lekin `published` qilishda nom talab qilinadi.
- Server xatosida chizilgan geometriya brauzerda saqlanib qoladi va qayta yuborish mumkin bo‘ladi.
- Bir obyektni ikki administrator bir vaqtda o‘zgartirsa, `updated_at` yoki versiya raqami orqali ziddiyat aniqlanadi.
- O‘chirishdan oldin tasdiqlash oynasi chiqadi.
- Arxivlangan obyektni qayta tiklash mumkin bo‘ladi.

## 9. Xavfsizlik

- Parollar faqat hash ko‘rinishida saqlanadi.
- Yozish API’lari autentifikatsiya va rol tekshiruviga ega bo‘ladi.
- Geometriya hajmi va nuqtalar soniga cheklov qo‘yiladi.
- SQL so‘rovlari parametrli bajariladi.
- API uchun CORS faqat kerakli domenlarga ruxsat beradi.
- Xarita fayllari o‘qish rejimida tarqatiladi.

## 10. Test strategiyasi

### Unit testlar

- Yo‘l formasi validatsiyasi.
- GeoJSON dan PostGIS formatiga aylantirish.
- Rol bo‘yicha ruxsatlar.
- Holat o‘tishlari: draft → published → archived.

### API testlar

- Ko‘cha yaratish, o‘qish, tahrirlash va arxivlash.
- Noto‘g‘ri geometriyani rad etish.
- Oddiy foydalanuvchining yozish so‘rovini bloklash.
- Qidiruv natijalari.

### Frontend testlar

- Chizish rejimiga kirish va chiqish.
- Forma va xarita holatining mosligi.
- Saqlash xatosida chizilgan yo‘lning yo‘qolmasligi.
- Mobil va kompyuter boshqaruvlari.

### Qabul testi

Administrator xaritani ochib, ichki ko‘chani chizadi, nomlaydi, saqlaydi, qayta tahrirlaydi va nashr qiladi. Keyin oddiy foydalanuvchi xaritani ochganda shu ko‘chani ko‘radi va nomi orqali topadi.

## 11. Loyiha tuzilishi

```text
koprik-xarita/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   └── shared/
├── database/
│   ├── migrations/
│   └── seeds/
├── map-data/
├── docs/
└── docker-compose.yml
```

`shared` paketida frontend va backend bir xil ishlatadigan yo‘l turlari, holatlar va API sxemalari saqlanadi.

## 12. Birinchi versiyaning muvaffaqiyat mezoni

- Loyiha lokal kompyuterda bitta buyruqlar ketma-ketligi bilan ishga tushadi.
- Administrator yangi yo‘lni chizib, ma’lumotlarini kiritib saqlaydi.
- Saqlangan yo‘l sahifa yangilangandan keyin ham mavjud bo‘ladi.
- Yo‘lni tahrirlash va arxivlash ishlaydi.
- Oddiy foydalanuvchi faqat nashr qilingan yo‘llarni ko‘radi.
- Interfeys telefon va kompyuterda ishlaydi.
- Asosiy xarita manbasini keyinchalik `surxondaryo.pmtiles` bilan almashtirish kodni qayta qurishni talab qilmaydi.
