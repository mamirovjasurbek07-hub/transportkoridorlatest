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
- route yo‘q bo‘lsa to‘g‘ri chiziq chizmasdan `review` holati;
- Yandex Maps xaritasi va OSRM adapteri, waypoint tartibi bo‘yicha to‘liq avtomobil yo‘li va PostGIS cache;
- HttpOnly cookie, CSRF, CORS allowlist, login rate-limit va audit;
- admin post CRUD, xaritadan lokatsiya, corridor waypoint muharriri;
- CSV analytics va GeoJSON corridor eksporti;
- Excel ma'lumotnomasi asosidagi 252 ta mamlakat kodi va xarita markaz koordinatasi;
- 93 ta bojxona posti, 52 ta tekshirilgan demo corridor va 10 000 ta versiyali mock deklaratsiya;
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

Public sahifada boshlanish/tugash davlati va sanani tanlab `Qo‘llash` bosing. Bir davlat juftligi uchun mavjud barcha post kombinatsiyalari alohida rang va yonlama offset bilan birga chiziladi. Xalqaro shablonlar xorijiy logistika gatewayidan O‘zbekiston postlari va tranzit yo‘li orqali keyingi gatewaygacha saqlangan OSRM geometriyasidan foydalanadi. Yo‘lak bosilganda post nomlari, transport ruxsati, oqim, ulush, masofa hamda minimal/o‘rtacha/maksimal tranzit vaqti ochiladi.

Admin sahifada:

1. `Bojxona postlari` bo‘limida yangi post yarating. Xaritani bosing yoki latitude/longitude kiriting — marker va fokus darhol yangilanadi. CHBP uchun yengil va/yoki yuk transporti ruxsatini belgilang. Mavjud post koordinatasi o‘zgarsa bog‘langan faol yo‘laklar qayta hisoblanadi.
2. `Korridorlar` bo‘limida yuk boshlanadigan/tugaydigan davlatlar hamda entry/exit postlarni tanlang. Davlat tanlanganda boshlanish va tugash markeri qo‘yiladi; uni xaritada sudrab aniq yuk manziliga olib boring.
3. `Boshlanish`, `Oraliq nuqta` yoki `Tugash` rejimini tanlab xaritani bosing. `Avtomobil yo‘lini ko‘rish` OSRM orqali barcha markerlarni real yo‘l bo‘yicha bog‘laydi; so‘ng `Bazaga saqlash` tugmasini bosing.
4. Oldin saqlangan geometriyalarni yangilash uchun corridorlar sahifasidagi `Barcha yo‘llarni yangilash` tugmasidan foydalaning. So‘rovlar Render va routerga og‘irlik qilmasligi uchun 5 tadan yuboriladi.
5. Router route topmasa geometriya saqlanmaydi va corridor review holatiga o‘tadi.
6. `Audit jurnali` barcha asosiy admin harakatlarini ko‘rsatadi.

## Yandex Maps sozlamasi

Yandex Developer Dashboard'da faqat `JavaScript API` kalitini oling. Render → Web Service → Environment bo‘limida quyidagilarni kiriting:

```text
MAP_PROVIDER=yandex
YANDEX_MAPS_API_KEY=JavaScript_API_kaliti
ROUTING_PROVIDER=osrm
ROUTING_PROFILE=driving
```

JavaScript API kalitining domain chekloviga Render bergan domenni protokolsiz kiriting, masalan `transportyo-laklari.onrender.com`. `YANDEX_ROUTER_API_KEY` kerak emas: Yandex faqat xarita uchun, avtomobil yo‘li hisoblash esa OSRM orqali bajariladi. JavaScript kaliti sozlanmagan bo‘lsa xarita OSM'ga qaytadi.

## Testlar

```bash
cd backend && pytest
cd frontend && npm test
```

Integration testlar uchun PostGIS bazasi kerak. Frontend production build: `npm run build`.

Arxitektura, API, ma’lumotlar modeli, ETRANZIT va Render yo‘riqnomasi: [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md).
