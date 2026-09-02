# 3D ko'rinish

Xarita ustidagi kub belgili tugma xaritani tekis ko'rinishdan qiya
ko'rinishga o'tkazadi va binolarni hajmli qilib chizadi.

## Nima 3D bo'ladi

| | Holat |
|---|---|
| **Binolar** | ✅ hajmli — balandligi ma'lumotdan hisoblanadi |
| **Kamera qiyaligi** | ✅ 55 daraja |
| **Yo'l va chegaralar** | tekis yotadi (ular chiziq, hajmi yo'q) |
| **Relyef (tog', vodiy)** | ❌ yo'q |
| **Fon xaritasi** | tekis — u rasm plitkalaridan iborat |

Relyef uchun alohida balandlik ma'lumoti (DEM) kerak bo'lardi va u
tashqi xizmatga bog'lanishni talab qiladi. Hozircha kiritilmadi.

## Bino balandligi qayerdan olinadi

```
balandlik = qavatlar soni × 3 metr
```

Qavat kiritilmagan bino uchun turiga qarab taxminiy qiymat:

| Tur | Taxmin |
|---|---|
| Turar-joy | 6 m |
| Tijorat | 8 m |
| Sanoat, Ta'lim | 9 m |
| Jamoat | 10 m |
| Diniy, Sog'liq | 12 m |
| Boshqa / noma'lum | 6 m |

Bu **taxmin**, o'lchov emas. Microsoft importidan kelgan binolarda
qavat ma'lumoti yo'q, shuning uchun ular hammasi taxminiy balandlikda
turadi. Aniq balandlik kerak bo'lsa, bino tahrirlanib qavati
kiritiladi — shundan keyin 3D ko'rinish darhol yangilanadi.

## Cheklovlar

- 3D binolar **14-darajadan yaqinlashganda** ko'rinadi. Uzoqdan hajm
  faqat shovqin qiladi va sekinlashtiradi.
- Qiyalik 60 daraja bilan cheklangan: undan ortig'ida raster fon
  xarita ufqda cho'zilib, tanib bo'lmas holga keladi.
- 3D yoqilganda tekis bino qatlami o'chadi — ikkalasi ustma-ust
  tushsa xunuk chiqadi.

## Sichqoncha bilan

Tugmasiz ham qiyalatish mumkin: `Ctrl` bosib turib sichqonchani
suring, yoki o'ng tugma bilan suring. Bunda tugma holati ham
o'zgaradi — kod `pitchend` hodisasini kuzatadi.

## Kod

```text
apps/web/public/view-3d.mjs    qatlam, balandlik mantiqi, tugma
tests/view-3d.test.mjs         balandlik ifodasi test qilingan
```

Balandlik MapLibre ifodasi sifatida yozilgan (ma'lumotga qarab
hisoblanadi). Test uni haqiqatda hisoblab tekshiradi — buning uchun
mitti ifoda tarjimoni yozilgan, shuning uchun "qavat 5 → 15 metr"
kabi da'volar haqiqatan sinaladi, faqat matn sifatida emas.
