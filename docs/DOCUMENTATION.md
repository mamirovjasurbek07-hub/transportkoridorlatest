# Tranzit geoanalitika — texnik hujjatlar

## Arxitektura

```text
React/Vite + MapLibre
        │ credentials: include / CSRF
        ▼
FastAPI API ── SQLAlchemy async ── PostgreSQL + PostGIS
        │                                │
        └── RoutingService ── OSRM       └── route_cache / geometry
```

Public analytics deklaratsiya darajasidagi nuqtalarni frontendga yubormaydi. SQL `GROUP BY entry_post_code, exit_post_code` orqali oqimni jamlaydi, mos faol corridorni topadi va faqat saqlangan PostGIS LineString geometriyasini GeoJSON bilan qaytaradi.

`RoutingService` provider/profile/rounded coordinates/order asosida SHA-256 cache-key yaratadi. Public so‘rov routerga chiqmaydi. Faqat admin preview/rebuild tashqi routerdan foydalanadi. Route topilmasa straight-line fallback yo‘q.

## API

Base URL: `/api`.

Public endpointlar:

- `GET /health`
- `GET /countries`
- `GET /posts`
- `GET /corridors`
- `GET /analytics?date_from=&date_to=&origin=&destination=&entry=&exit=&corridor=`
- `GET /analytics/export.csv`
- `GET /analytics/corridors.geojson`

Auth endpointlar:

- `POST /auth/login` — HttpOnly access cookie va CSRF token;
- `GET /auth/me`;
- `POST /auth/logout`.

Admin endpointlar:

- `POST/PATCH/DELETE /posts`;
- `POST/PATCH/DELETE /corridors`;
- `POST /corridors/preview`;
- `GET/POST/PUT/DELETE /gateways`;
- `GET /settings/dashboard`;
- `POST /declarations/mock/reset`;
- `GET /audit`.

O‘zgartiruvchi so‘rovlar `X-CSRF-Token` headerini talab qiladi. Xato formati:

```json
{"error":{"code":"VALIDATION_ERROR","message":"...","details":{}}}
```

## Ma’lumotlar modeli

- `users` — admin/viewer va password hash;
- `customs_posts` — string post kodi, tipi, coordinates va PostGIS geography point;
- `country_gateways` — uzoq davlatlar uchun tasdiqlangan gateway;
- `corridors` — matching maydonlari, status va PostGIS LineString;
- `corridor_waypoints` — tartiblangan gateway/entry/via/exit nuqtalar;
- `transit_declarations` — ETRANZITga mos normalized analitik yozuv;
- `route_cache` — provider/profile/waypoint hash va geometriya;
- `audit_logs` — ma’muriy harakatlar;
- `app_settings` — JSONB sozlamalar.

Migration avval `CREATE EXTENSION IF NOT EXISTS postgis` bajaradi. `post_code` `varchar(10)` bo‘lib, `00101` kabi leading zero yo‘qolmaydi.

## ETRANZIT integratsiyasi

Web ilova yopiq ETRANZIT bazasiga write qilmasligi kerak. Tavsiya etilgan oqim:

1. readonly SQL view yoki nazorat qilinadigan ETL;
2. ETRANZIT ustunlarini normalized declaration sxemasiga mapping;
3. idempotent import (`source_system`, `declaration_no` unique);
4. validatsiya va import audit natijasi;
5. analytics bazasida indekslangan query.

Majburiy mappinglar: declaration number/date, origin/destination ISO-2, entry/exit post code. Entry/exit time bo‘lsa o‘rtacha tranzit hisoblanadi. Shaxsiy yoki keraksiz tashuvchi ma’lumoti public API javobiga chiqarilmaydi. Noma’lum `G29` kabi ustunlar tasdiqsiz post kodi sifatida qabul qilinmaydi.

## Render’ga joylash

### GitHub

1. GitHub’da yangi repository yarating.
2. Ushbu papkadagi barcha fayllarni commit/push qiling.
3. `.env` faylini push qilmang; `.env.example` faqat namuna.

### Blueprint

Render Dashboard’da `New → Blueprint` tanlab GitHub repositoryni ulang. `render.yaml` PostgreSQL, FastAPI Web Service va React Static Site yaratadi.

Blueprint so‘ragan qiymatlar:

- `ADMIN_INITIAL_EMAIL`;
- `ADMIN_INITIAL_PASSWORD` — kuchli va noyob;
- backend `CORS_ORIGINS` va `FRONTEND_URL` — frontendning `https://...onrender.com` domeni;
- frontend `VITE_API_BASE_URL` — `https://<backend>.onrender.com/api`;
- `VITE_MAP_STYLE_URL` — ixtiyoriy production tile style URL.

`SECRET_KEY` Render tomonidan yaratiladi. `DATABASE_URL` database’dan avtomatik olinadi.

### Qo‘lda yaratish

Backend Web Service:

- Root Directory: `backend`
- Build: `pip install -r requirements.txt`
- Pre-deploy: `alembic upgrade head`
- Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health Check: `/api/health`

Frontend Static Site:

- Root Directory: `frontend`
- Build: `npm ci && npm run build`
- Publish Directory: `dist`
- Rewrite: `/* → /index.html` (200 Rewrite)

### Birinchi deploy tekshiruvi

1. Backend logida migration va health muvaffaqiyatli ekanini tekshiring.
2. `/api/health` `status: ok` qaytarishi kerak.
3. Public frontendda mock corridorlar chiqishi kerak.
4. `/admin/login` orqali kiring.
5. Birinchi production login’dan keyin initial parolni almashtiring.

`ENABLE_DEMO_SEED=true` seedni idempotent ishlatadi. Real ma’lumotga o‘tganda uni `false` qiling. Frontend/backend alohida Render domenlarida bo‘lsa `COOKIE_SECURE=true` bo‘lishi shart. Eng ishonchli production variant — `app.example.uz` va `api.example.uz` kabi bitta custom domain subdomainlari.

