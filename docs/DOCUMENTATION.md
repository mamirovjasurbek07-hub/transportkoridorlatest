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

Public analytics deklaratsiya darajasidagi nuqtalarni frontendga yubormaydi. SQL `GROUP BY origin_country_code, destination_country_code, entry_post_code, exit_post_code` orqali oqimni jamlaydi, mos faol corridorni topadi va faqat saqlangan PostGIS LineString geometriyasini GeoJSON bilan qaytaradi. Shu sabab bir davlat juftligidagi bir nechta kirish/chiqish post yo‘laklari bir vaqtda alohida rangda ko‘rsatiladi.

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
- `customs_posts` — string post kodi, tipi, koordinata, PostGIS geography point va yengil/yuk transport ruxsatlari;
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

### Supabase database

1. Supabase’da bepul loyiha yarating.
2. SQL Editor’da `create extension if not exists postgis with schema extensions;` bajaring.
3. `Connect → Session pooler` URI qiymatini oling. Bepul loyiha bilan IPv4 orqali ishlashi uchun `5432` portli Session pooler ishlatiladi.
4. Shu URI’ni Render’dagi `DATABASE_URL` qiymatiga kiriting va `DATABASE_SSL=true` qiling.

Supabase `anon key` yoki `service_role key` kerak emas: FastAPI PostgreSQL’ga SQLAlchemy orqali server tomondan ulanadi.

### Blueprint

Render Dashboard’da `New → Blueprint` tanlab GitHub repositoryni ulang. `render.yaml` frontend va backendni bitta bepul Docker Web Service sifatida yaratadi. Sayt va API bir xil `https://transportyo-laklari.onrender.com` domenida ishlaydi.

Blueprint so‘ragan qiymatlar:

- `DATABASE_URL` — Supabase Session pooler URI;
- `ADMIN_INITIAL_EMAIL` — Render'dagi amaldagi admin emaili;
- `ADMIN_INITIAL_PASSWORD` — Render'dagi amaldagi, kuchli va noyob admin paroli.
- `YANDEX_MAPS_API_KEY` — Yandex JavaScript API kaliti (public xarita uchun);
- `YANDEX_ROUTER_API_KEY` — Yandex Router API kaliti (backendda yo‘l geometriyasini olish uchun).

Yandex uchun `MAP_PROVIDER=yandex`, `ROUTING_PROVIDER=yandex` va odatiy avtomobil yo‘li uchun `ROUTING_PROFILE=driving` bo‘lishi kerak. JavaScript API kalitini Yandex kabinetida Render domeniga cheklang. Router kaliti frontendga berilmaydi. Kalit hali tayyor bo‘lmasa xarita OSM, routing OSRM fallback bilan ishlaydi.

Ilovada hozircha alohida parol almashtirish ekrani yo'q. Shu sabab servis ishga
tushganda bu ikki env qiymati Supabase'dagi yagona admin bilan sinxronlanadi.
Kirish ma'lumotini tiklash uchun Render'da ikkala qiymatni yangilang va yangi
deploy ishga tushiring. Supabase'ga ochiq parol yozilmaydi.

`SECRET_KEY` Render tomonidan avtomatik yaratiladi.

### Qo‘lda yaratish

Docker Web Service:

- Name: `transportyo-laklari`
- Language: `Docker`
- Branch: `main`
- Region: `Singapore`
- Root Directory: bo‘sh
- Dockerfile Path: `backend/Dockerfile`
- Instance Type: `Free`
- Health Check: `/api/health`

Docker image frontendni build qiladi, FastAPI fayllari bilan birlashtiradi va container ishga tushishida `alembic upgrade head` migratsiyasini avtomatik bajaradi.

### Birinchi deploy tekshiruvi

1. Render logida frontend build, migration va health muvaffaqiyatli ekanini tekshiring.
2. `/api/health` `status: ok` qaytarishi kerak.
3. Public frontendda mock corridorlar chiqishi kerak.
4. `/admin/login` orqali kiring.
5. Birinchi production login’dan keyin initial parolni almashtiring.

`ENABLE_DEMO_SEED=true` seedni idempotent ishlatadi. Real ma’lumotga o‘tganda uni `false` qiling. Production’da `COOKIE_SECURE=true` va `COOKIE_SAMESITE=lax` bo‘lishi kerak.

Demo seed `DEMO_V4` manbasi bilan 10 000 ta deklaratsiya va 52 ta shablon yo‘lak yaratadi. Ular Qirg‘iziston–Afg‘onistonning 4 ta va Qozog‘iston–Turkmanistonning 8 ta post kombinatsiyasi, Xitoydan g‘arb/janub tranziti, Rossiya, Kavkaz, Janubiy Osiyo hamda O‘zbekiston–Xitoy/Yevropa/Turkiya/Afg‘oniston yo‘nalishlarini qamrab oladi. Oldingi demo versiyalar yangi versiya birinchi marta ishga tushganda almashtiriladi. Mavjud barcha corridorni to‘liq Yandex/OSRM yo‘l geometriyasiga almashtirish uchun admin paneldagi `Barcha yo‘llarni yangilash` tugmasi ishlatiladi.

Yangi corridor konstruktori davlat tanlanganda mamlakat koordinatasini boshlang‘ich gateway sifatida qo‘yadi. Admin markerning o‘zini aniq ombor yoki logistika nuqtasiga sudrab ko‘chirishi, kirish/chiqish postlarini tanlashi va istalgancha VIA nuqta qo‘shishi mumkin. Preview tasdiqlangandan keyin gateway, post, VIA tartibi, route geometriyasi, masofa, vaqt va router provayderi Supabase/PostGIS bazasida saqlanadi.

Post koordinatasi admin paneldan o‘zgartirilganda shu kodni entry yoki exit sifatida ishlatadigan barcha faol corridor waypointlari yangilanadi va routing qayta hisoblanadi. Muvaffaqiyatsiz route eski noto‘g‘ri geometriya bilan qoldirilmaydi, `REVIEW` holatiga o‘tkaziladi. Admin tomonidan qayta qurilgan `post-update-osrm` geometriya keyingi seed startupida ustidan yozilmaydi.
