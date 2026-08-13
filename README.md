# Tranzit transport yo‘laklari

O‘zbekiston orqali o‘tadigan tranzit deklaratsiyalarni kirish/chiqish postlari bo‘yicha guruhlaydigan, tasdiqlangan avtomobil yo‘li geometriyasini Yandex Maps xaritasida ko‘rsatadigan full-stack geoanalitik tizim.

Loyiha GitHub monorepo va Render xizmatlari uchun tayyorlangan:

- `frontend/` — React 19, TypeScript, Vite, Yandex Maps (kalit bo'lmasa MapLibre fallback), TanStack Query, Recharts;
- `backend/` — FastAPI, SQLAlchemy async, PostgreSQL/PostGIS, Alembic;
- `render.yaml` — bitta bepul Render Docker Web Service blueprint;
- `docker-compose.yml` — lokal PostGIS, backend va frontend.

Production’da React frontend FastAPI bilan bitta Render domenidan beriladi, ma’lumotlar esa Supabase PostgreSQL/PostGIS bazasida saqlanadi.

## Asosiy imkoniyatlar

- joriy yil 1-yanvaridan bugungacha default sana filtri;
- origin/destination, kirish/chiqish posti va corridor bo‘yicha filtr;
- filter holatini URL query-param orqali ulashish;
- oqim hajmiga mos qalinlikdagi glow/core/animated corridor layerlar;
- post clustering va post ma’lumotlari popup’i;
- public xarita dastlab faqat bojxona postlarini ko‘rsatadi; bitta corridor yoki tashuv hajmi bo‘yicha `Top-5 yo‘lak` alohida tanlanadi;
- boshlanish davlati tanlangach tugash davlatlari bazadagi mavjud corridor guruhlaridan avtomatik torayadi; masalan, `CN → AF` guruhidagi barcha alternativ corridorlar birga ko‘rsatiladi;
- post markerlari kirish+chiqish oqimiga mos kattalashadigan sfera ko‘rinishida, xarita esa katta-ekran tugmasi va `Esc` bilan yopish imkoniyatiga ega;
- ISO-2, raqamli kod yoki nom bo‘yicha tezkor davlat qidiruvi (`UZ - 860 - O'ZBEKISTON`);
- Yandex sxema/satellite/hybrid rejimlari, ma’muriy chegaralar va qizil uzlukli O‘zbekiston konturi;
- route yo‘q bo‘lsa to‘g‘ri chiziq chizmasdan `review` holati;
- Yandex Maps xaritasi va OSRM adapteri, waypoint tartibi bo‘yicha to‘liq avtomobil yo‘li va PostGIS cache;
- HttpOnly cookie, CSRF, CORS allowlist, login rate-limit va audit;
- admin post CRUD, xaritadan lokatsiya, corridor waypoint muharriri;
- CSV analytics va GeoJSON corridor eksporti;
- Excel ma'lumotnomasi asosidagi 252 ta mamlakat kodi va xarita markaz koordinatasi;
- 93 ta bojxona posti, OSRM tomonidan avtomatik quriladigan 52 ta demo corridor va 10 000 ta versiyali mock deklaratsiya;
- idempotent post/corridor/mock seed.

## Docker bilan ishga tushirish

```bash
docker compose up --build
```

So‘ng:

- public web: `http://localhost:5173`
- admin: `http://localhost:5173/admin/login`
- API health: `http://localhost:8000/api/health`
- API docs: `http://localhost:8000/api/docs`

Docker demo login qiymatlari: `admin@example.local` / `CHANGE_ME_NOW`. Production’da bu parolni ishlatmang.

Render/Supabase deploymentida `ADMIN_INITIAL_EMAIL` va `ADMIN_INITIAL_PASSWORD`
admin kirish ma'lumotlarining asosiy manbasi hisoblanadi. Ular o'zgartirilib servis
qayta deploy qilinsa, mavjud yagona admin yozuvi yangi qiymatlar bilan xavfsiz
sinxronlanadi. Parolning o'zi bazada saqlanmaydi, faqat uning himoyalangan hash'i
saqlanadi.

## Lokal dasturlash

Backend uchun Python 3.12+ va PostGIS ishlayotgan PostgreSQL kerak. Ushbu loyiha tayyorlanayotganda kompyuterdagi Python ishga tushirilmadi.

```bash
cd backend
python -m venv .venv
```

Windows:

```powershell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item ..\.env.example .env
alembic upgrade head
uvicorn app.main:app --reload
```

Linux/macOS:

```bash
source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env
alembic upgrade head
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Foydalanuvchi yo‘riqnomasi

Public sahifa dastlab corridor chizmasdan faqat bojxona postlarini ko‘rsatadi. Bitta corridorni tanlang yoki tashuv hajmi eng katta beshta post yo‘nalishini `Top-5 yo‘lak` orqali oching. Chiziqlar yon tomonga surilmaydi va OSRM geometriyasining aynan ustida chiziladi. Yo‘lak bosilganda post nomlari, transport ruxsati, oqim, ulush, masofa hamda minimal/o‘rtacha/maksimal tranzit vaqti ochiladi.

Davlat filtri ikki bosqichli ishlaydi: avval boshlanish davlati tanlanadi, so‘ng faqat shu davlat uchun bazada mavjud tugash davlatlari chiqadi. `Qo‘llash` tanlangan davlat juftligini bitta yo‘nalish guruhi sifatida ochadi va guruhdagi barcha alternativ corridorlarni xaritada ko‘rsatadi. Chegara GeoJSON’i brauzerdan GitHub’ga so‘ralmaydi; backend proxy orqali olinib 24 soat keshlanadi.

Chegara proxy Git LFS pointer faylini emas, `media.githubusercontent.com` dagi haqiqiy GeoJSON faylini oladi. Tashqi manbalar vaqtincha ishlamasa endpoint 503 bermaydi va xarita Yandex ma’muriy chegarasi bilan ishlashda davom etadi. Corridor create/update commitidan keyin obyekt explicit async so‘rov bilan qayta yuklanadi; bu SQLAlchemy `MissingGreenlet` xatosining oldini oladi.

Admin sahifada:

1. `Bojxona postlari` bo‘limida yangi post yarating. Xaritani bosing yoki `41.310617600000036, 69.21984867557755` formatida koordinatani bitta maydonga kiriting — marker va fokus darhol yangilanadi. CHBP uchun yengil va/yoki yuk transporti ruxsatini belgilang. Mavjud post koordinatasi o‘zgarsa bog‘langan faol yo‘laklar qayta hisoblanadi.
2. `Korridorlar` bo‘limida yuk boshlanadigan/tugaydigan davlatlar hamda entry/exit postlarni tanlang. Davlat kodi (`UZ`), raqamli kodi (`860`) yoki nomini yozib qidiring.
3. `Boshlanish`, `Kirish posti`, `Oraliq/TIF`, `Chiqish posti` yoki `Tugash` rejimini tanlang. Xaritadagi post markerini bosish postni shu rolga avtomatik bog‘laydi. Postga bog‘langan route nuqtasi backendda ham bazadagi aniq post koordinatasiga snap qilinadi.
4. Oddiy nuqtalarni sudrang; nuqta qatoridagi `+` bilan aynan undan keyin yangi VIA qo‘shing, strelkalar bilan tartiblang yoki `×` bilan olib tashlang. Yandex xaritasida corridor chizig‘ining ustini bosish ham eng yaqin segmentga VIA qo‘shadi. Har bir o‘zgarishdan 700 ms keyin barcha nuqtalar OSRM qaytargan real avtomobil yo‘li bilan avtomatik qayta bog‘lanadi; yangi javob kelguncha chiziq va foydalanuvchi tanlagan xarita masshtabi saqlanadi. So‘ng `Bazaga saqlash` tugmasini bosing.
5. Oldin saqlangan geometriyalarni yangilash uchun corridorlar sahifasidagi `Barcha yo‘llarni yangilash` tugmasidan foydalaning. So‘rovlar Render va routerga og‘irlik qilmasligi uchun 5 tadan yuboriladi.
6. Router route topmasa geometriya saqlanmaydi va corridor review holatiga o‘tadi.
7. `Audit jurnali` barcha asosiy admin harakatlarini ko‘rsatadi.

## Yandex Maps sozlamasi

Yandex Developer Dashboard'da faqat `JavaScript API` kalitini oling. Render → Web Service → Environment bo‘limida quyidagilarni kiriting:

```text
MAP_PROVIDER=yandex
YANDEX_MAPS_API_KEY=JavaScript_API_kaliti
ROUTING_PROVIDER=osrm
ROUTING_PROFILE=driving
```

JavaScript API kalitining domain chekloviga Render bergan domenni protokolsiz kiriting, masalan `transportyo-laklari.onrender.com`. `YANDEX_ROUTER_API_KEY` kerak emas: Yandex faqat xarita uchun, avtomobil yo‘li hisoblash esa OSRM orqali bajariladi. JavaScript kaliti sozlanmagan bo‘lsa xarita OSM'ga qaytadi.

Production startup eski qo‘lda yozilgan `verified-osrm-seed-v2/v3/v4` geometriyalarini darhol bekor qiladi. Background migratsiya demo corridorlarni OSRM Route API orqali soniyasiga ko‘pi bilan bitta tashqi so‘rov bilan qayta quradi. Public sahifa shu vaqtda noto‘g‘ri straight-line chizmaydi va tayyor bo‘lmagan route’larni 15 soniyada qayta tekshiradi.

Public analytics `posts`, `top5` va tanlangan corridor rejimlariga bo‘lingan. Dastlab geometriya yuborilmaydi; corridor katalogi waypoint va geometrysiz olinadi. PostGIS geometriyalari bitta batch SQL so‘rovda o‘qiladi, 1 KB dan katta javoblar GZip qilinadi va Supabase connection pool `3 + 2 overflow` bilan cheklangan.

## Testlar

```bash
cd backend && pytest
cd frontend && npm test
```

Integration testlar uchun PostGIS bazasi kerak. Frontend production build: `npm run build`.

Arxitektura, API, ma’lumotlar modeli, ETRANZIT va Render yo‘riqnomasi: [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md).
