# Tranzit transport yo‘laklari

O‘zbekiston orqali o‘tadigan tranzit deklaratsiyalarni kirish/chiqish postlari bo‘yicha guruhlaydigan, tasdiqlangan avtomobil yo‘li geometriyasini MapLibre xaritasida neon oqim sifatida ko‘rsatadigan full-stack geoanalitik tizim.

Loyiha GitHub monorepo va Render xizmatlari uchun tayyorlangan:

- `frontend/` — React 19, TypeScript, Vite, MapLibre, TanStack Query, Recharts;
- `backend/` — FastAPI, SQLAlchemy async, PostgreSQL/PostGIS, Alembic;
- `render.yaml` — Render PostgreSQL, Web Service va Static Site blueprint;
- `docker-compose.yml` — lokal PostGIS, backend va frontend.

## Asosiy imkoniyatlar

- joriy yil 1-yanvaridan bugungacha default sana filtri;
- origin/destination, kirish/chiqish posti va corridor bo‘yicha filtr;
- filter holatini URL query-param orqali ulashish;
- oqim hajmiga mos qalinlikdagi glow/core/animated corridor layerlar;
- post clustering va post ma’lumotlari popup’i;
- route yo‘q bo‘lsa to‘g‘ri chiziq chizmasdan `review` holati;
- OSRM adapteri, waypoint tartibi bo‘yicha route va PostGIS cache;
- HttpOnly cookie, CSRF, CORS allowlist, login rate-limit va audit;
- admin post CRUD, xaritadan lokatsiya, corridor waypoint muharriri;
- CSV analytics va GeoJSON corridor eksporti;
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

Public sahifada boshlanish/tugash davlati va sanani tanlab `Qo‘llash` bosing. Chiziq qalinligi deklaratsiyalar sonini, rang va glow faol corridorni bildiradi. Corridor ustiga bosilganda oqim, ulush, masofa va o‘rtacha tranzit vaqti ochiladi. Marker post turi, kodi va kirish/chiqish oqimini ko‘rsatadi.

Admin sahifada:

1. `Bojxona postlari` bo‘limida yangi post yarating va xaritani bosib lokatsiya belgilang.
2. `Korridorlar` bo‘limida davlatlar, entry/exit postlar va VIA nuqtalarni tartiblang.
3. `Route preview` OSRM orqali avtomobil yo‘lini hisoblaydi; muvaffaqiyatli preview’dan keyin saqlang.
4. Router route topmasa geometriya saqlanmaydi va corridor review holatiga o‘tadi.
5. `Audit jurnali` barcha asosiy admin harakatlarini ko‘rsatadi.

## Testlar

```bash
cd backend && pytest
cd frontend && npm test
```

Integration testlar uchun PostGIS bazasi kerak. Frontend production build: `npm run build`.

Arxitektura, API, ma’lumotlar modeli, ETRANZIT va Render yo‘riqnomasi: [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md).
