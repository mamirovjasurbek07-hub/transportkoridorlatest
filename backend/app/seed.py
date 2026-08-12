import json
import math
import random
from datetime import UTC, date, datetime, time, timedelta

import structlog
from geoalchemy2.functions import ST_GeomFromGeoJSON, ST_SetSRID, ST_MakePoint
from sqlalchemy import delete, func, insert, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload

from app.config import settings
from app.models import Corridor, CorridorWaypoint, CountryGateway, CustomsPost, TransitDeclaration, User
from app.security import hash_password, verify_password


logger = structlog.get_logger()


POSTS = [
    ("35001", "Nukus aeroporti", "AERO", None), ("35002", "Nukus TIF", "TIF", None),
    ("35003", "Xo'jayli", "CHBP", "TM"), ("35004", "Dovut-ota", "CHBP", "KZ"), ("35010", "Qoraqalpog'iston temir yo'l", "RW", None),
    ("03002", "Do'stlik", "CHBP", "KG"), ("03003", "Andijon aeroporti", "AERO", None), ("03005", "Mingtepa", "CHBP", "KG"),
    ("03006", "Qorasuv", "CHBP", "KG"), ("03007", "Xonobod", "CHBP", "KG"), ("03008", "Pushmon", "CHBP", "KG"),
    ("03009", "Madaniyat", "CHBP", "KG"), ("03011", "Andijon TIF", "TIF", None), ("03013", "Keskanyor", "CHBP", "KG"),
    ("03014", "Savay temir yo'l", "RW", None), ("03015", "Asaka TIF", "TIF", None),
    ("06001", "Buxoro aeroporti", "AERO", None), ("06006", "Buxoro TIF", "TIF", None), ("06009", "Qorako'l TIF", "TIF", None),
    ("06010", "Olot", "CHBP", "TM"), ("06011", "Xo'jadavlat temir yo'l", "RW", None),
    ("08003", "Uchto'rg'on", "CHBP", "TJ"), ("08004", "Jizzax TIF", "TIF", None), ("08007", "Qo'shkent", "CHBP", "TJ"),
    ("10002", "Nasaf TIF", "TIF", None), ("10007", "Qamashi-G'uzor TIF", "TIF", None), ("10008", "Qarshi-Kerki", "CHBP", "TM"),
    ("10012", "Qarshi aeroporti", "AERO", None), ("12002", "Navoiy aeroporti", "AERO", None), ("12003", "Navoiy TIF", "TIF", None),
    ("12008", "Zarafshon TIF", "TIF", None), ("14002", "Namangan aeroporti", "AERO", None), ("14003", "Uchqo'rg'on", "CHBP", "KG"),
    ("14004", "Kosonsoy", "CHBP", "KG"), ("14005", "Pop", "CHBP", "TJ"), ("14010", "Namangan TIF", "TIF", None),
    ("18001", "Samarqand aeroporti", "AERO", None), ("18002", "Jartepa", "CHBP", "TJ"), ("18005", "Samarqand TIF", "TIF", None),
    ("18007", "Ulug'bek TIF", "TIF", None), ("22002", "Termiz aeroporti", "AERO", None), ("22003", "Sariosiyo", "CHBP", "TJ"),
    ("22004", "Sariosiyo temir yo'l", "RW", None), ("22005", "Termiz TIF", "TIF", None), ("22006", "Denov TIF", "TIF", None),
    ("22007", "Gulbahor", "CHBP", "TJ"), ("22011", "Daryo porti", "PORT", None), ("22015", "Boldir temir yo'l", "RW", None),
    ("22017", "Ayritom", "CHBP", "AF"), ("22022", "Termiz xalqaro savdo markazi", "TIF", None),
    ("24002", "Xovosobod", "CHBP", "TJ"), ("24004", "Sirdaryo", "CHBP", "KZ"), ("24006", "Oq oltin", "CHBP", "KZ"),
    ("24009", "Guliston TIF", "TIF", None), ("24014", "Malik", "CHBP", "KZ"),
    ("27001", "Yallama", "CHBP", "KZ"), ("27008", "Navoiy", "CHBP", "KZ"), ("27009", "S. Najimov", "CHBP", "KZ"),
    ("27011", "Oybek", "CHBP", "TJ"), ("27013", "Bekobod avto", "CHBP", "TJ"), ("27014", "Chirchiq TIF", "TIF", None),
    ("27015", "Olmaliq TIF", "TIF", None), ("27016", "Yangiyo'l TIF", "TIF", None), ("27019", "Nazarbek TIF", "TIF", None),
    ("27020", "Keles TIF", "TIF", None), ("27021", "G'ishtko'prik", "CHBP", "KZ"), ("27023", "Farhod", "CHBP", "TJ"),
    ("27024", "Bekobod temir yo'l", "RW", None), ("27028", "Angren TIF", "TIF", None),
    ("30001", "Farg'ona aeroporti", "AERO", None), ("30002", "Qo'qon TIF", "TIF", None), ("30004", "Farg'ona", "CHBP", "KG"),
    ("30005", "Andarxon", "CHBP", "TJ"), ("30006", "Rishton", "CHBP", "KG"), ("30008", "Rovot", "CHBP", "TJ"),
    ("30009", "Vodiy TIF", "TIF", None), ("30010", "O'zbekiston", "CHBP", "KG"), ("30012", "So'x", "CHBP", "KG"),
    ("33001", "Shovot", "CHBP", "TM"), ("33004", "Do'stlik", "CHBP", "TM"), ("33007", "Urganch TIF", "TIF", None),
    ("33011", "Urganch aeroporti", "AERO", None), ("33033", "Shovot chegaraoldi savdo zonasi", "CHBP", "TM"),
    ("26002", "Toshkent-tovar TIF", "TIF", None), ("26003", "Ark buloq TIF", "TIF", None),
    ("26004", "Chuqursoy TIF", "TIF", None), ("26009", "Keles temir yo'l", "RW", None), ("26010", "Sirg'ali TIF", "TIF", None),
    ("26013", "Chuqursoy texnik idora", "TIF", None), ("00101", "Islom Karimov nomidagi Toshkent xalqaro aeroporti", "AERO", None),
    ("00102", "Avia yuklar TIF", "TIF", None), ("00107", "Elektron tijorat TIF", "TIF", None), ("00110", "Toshkent-Humo aeroporti", "AERO", None),
]


def _official_post_name(code: str, name: str, post_type: str) -> str:
    if code == "26013":
        return "“Chuqursoy texnik idora” temir yo'l chegara bojxona posti"
    if post_type == "TIF":
        base = name[:-4] if name.endswith(" TIF") else name
        return f"“{base}” TIF bojxona posti"
    return f"“{name}” chegara bojxona posti"

COORDINATES = {
    "35004": (43.1355, 58.5986), "35003": (42.4045, 59.4512), "06010": (39.1537, 63.5141),
    "10008": (38.8841, 65.7172), "22017": (37.2251, 67.4274), "22003": (38.5065, 68.0205),
    "18002": (39.5309, 67.4089), "27011": (40.1678, 69.6056), "27013": (40.2307, 69.1725),
    "27021": (41.4688, 69.0717), "27001": (41.5852, 69.6584), "24004": (40.9284, 68.8225),
    "03002": (40.4443, 72.3436), "03006": (40.7047, 72.8823), "14003": (41.1357, 72.0795),
    "30004": (40.3734, 71.7603), "30010": (40.4168, 70.6102), "30006": (40.0317, 71.0772),
    "33001": (41.6538, 60.3001), "33004": (41.3337, 60.6175), "00101": (41.2579, 69.2812),
    "06006": (39.7681, 64.4556), "18005": (39.6542, 66.9597), "22005": (37.2611, 67.3086),
}

ROUTES = [
    {"code": "KZ-UZ-TM-A", "name": "Qozog'iston — O'zbekiston — Turkmaniston", "origin": "KZ", "destination": "TM", "entry": "27021", "exit": "06010", "color": "#22d3ee",
     "distance": 861406, "duration": 58147,
     "waypoints": [[69.0717,41.4688],[69.20,41.35],[69.28,41.15],[68.78,40.52],[67.85,40.12],[66.97,39.66],[65.75,39.53],[64.46,39.77],[63.5141,39.1537]],
     "coords": [[69.072837,41.467402],[69.206447,41.476017],[69.199881,41.35],[69.217808,41.17171],[69.279502,41.149757],[69.335079,41.072631],[69.26538,40.942374],[69.30057,40.885732],[69.128471,40.735853],[68.94522,40.683625],[68.884472,40.619346],[68.720453,40.625978],[68.780188,40.520054],[68.73154,40.5085],[68.633447,40.571743],[68.521507,40.503588],[68.37678,40.567233],[68.031878,40.266602],[67.902611,40.204426],[67.850359,40.119931],[67.654724,40.063825],[67.445205,39.83737],[66.970061,39.660002],[66.925525,39.587213],[66.751798,39.5374],[66.585525,39.543094],[66.497848,39.500488],[66.263646,39.615939],[66.108737,39.567668],[65.989622,39.582485],[65.966557,39.646407],[65.761688,39.602143],[65.770382,39.533066],[65.77347,39.41589],[65.709521,39.350961],[65.599948,39.062179],[65.155624,39.268174],[65.063535,39.374423],[64.792599,39.509907],[64.582249,39.733129],[64.460344,39.770201],[64.199518,39.739215],[64.170574,39.67931],[63.973011,39.603789],[63.84359,39.505314],[63.710277,39.207698],[63.597718,39.224252],[63.561989,39.117741],[63.501116,39.12643],[63.514618,39.150282]]},
    {"code": "KG-UZ-AF-A", "name": "Qirg'iziston — O'zbekiston — Afg'oniston", "origin": "KG", "destination": "AF", "entry": "03002", "exit": "22017", "color": "#38bdf8",
     "distance": 1273102, "duration": 82489,
     "waypoints": [[72.3436,40.4443],[71.78,40.38],[70.94,40.51],[69.65,40.72],[69.28,41.15],[68.78,40.52],[67.85,40.12],[66.97,39.66],[67.4274,37.2251]],
     "coords": [[72.345325,40.457097],[72.33326,40.504105],[72.120536,40.514871],[71.779961,40.380019],[71.70034,40.429136],[71.324497,40.326352],[71.213516,40.470422],[70.996192,40.533098],[70.939649,40.512184],[70.829115,40.682111],[70.779868,40.883889],[70.447452,41.155461],[70.311443,41.074041],[70.172754,41.059501],[69.810896,40.910266],[69.597102,40.920524],[69.554754,40.816112],[69.596394,40.717477],[69.654702,40.716352],[69.596105,40.717892],[69.554668,40.816667],[69.59621,40.928346],[69.436336,41.13072],[69.327982,41.164972],[69.331138,41.191383],[69.279502,41.149757],[69.335079,41.072631],[69.26538,40.942374],[69.30057,40.885732],[69.128471,40.735853],[68.94522,40.683625],[68.884472,40.619346],[68.720453,40.625978],[68.780188,40.520054],[68.73154,40.5085],[68.633447,40.571743],[68.521507,40.503588],[68.37678,40.567233],[68.031878,40.266602],[67.902611,40.204426],[67.850359,40.119931],[67.654724,40.063825],[67.445205,39.83737],[66.970061,39.660002],[66.926884,39.588036],[66.863195,39.566546],[66.565049,39.536773],[66.355487,39.375297],[66.253009,39.235054],[66.206768,39.056659],[66.228766,38.737674],[66.311084,38.629477],[66.34271,38.50248],[66.430405,38.480755],[66.475796,38.354878],[66.730375,38.305941],[66.943048,38.201967],[67.029195,38.218868],[66.982243,38.208335],[66.968204,38.060563],[67.065123,37.88565],[66.991729,37.761214],[66.995178,37.672423],[67.089789,37.575222],[67.179617,37.371187],[67.254278,37.382115],[67.375063,37.329158],[67.426604,37.224892]]},
    {"code": "TJ-UZ-KZ-A", "name": "Tojikiston — O'zbekiston — Qozog'iston", "origin": "TJ", "destination": "KZ", "entry": "27011", "exit": "27021", "color": "#fb4058",
     "distance": 249180, "duration": 17604,
     "waypoints": [[69.6056,40.1678],[69.45,40.43],[69.33,40.78],[69.28,41.15],[69.19,41.31],[69.0717,41.4688]],
     "coords": [[69.610227,40.166255],[69.637904,40.208796],[69.645402,40.256967],[69.635213,40.270676],[69.644041,40.271409],[69.637801,40.298532],[69.68264,40.313417],[69.707615,40.367671],[69.704316,40.397811],[69.683177,40.420724],[69.627609,40.421043],[69.440957,40.464783],[69.46123,40.430999],[69.464248,40.422903],[69.422509,40.412696],[69.396515,40.475878],[69.331544,40.494711],[69.328151,40.514953],[69.318378,40.518385],[69.324949,40.531801],[69.295892,40.54597],[69.2599,40.554928],[69.207011,40.550517],[69.213578,40.638664],[69.301582,40.654065],[69.298174,40.666838],[69.313776,40.685816],[69.313194,40.767405],[69.319765,40.782201],[69.327955,40.777977],[69.319862,40.782416],[69.326395,40.806118],[69.359289,40.834695],[69.353533,40.869281],[69.361391,40.869121],[69.340919,40.894237],[69.337138,40.887741],[69.301206,40.886155],[69.2721,40.909058],[69.265368,40.942256],[69.306289,41.000215],[69.335295,41.072689],[69.317878,41.141852],[69.298412,41.136981],[69.303581,41.145651],[69.294926,41.152696],[69.279502,41.149757],[69.271057,41.155868],[69.278435,41.164737],[69.221944,41.170788],[69.234598,41.194762],[69.229674,41.209053],[69.244833,41.21515],[69.237879,41.265327],[69.201859,41.28919],[69.19001,41.309972],[69.193678,41.325887],[69.227965,41.349447],[69.200111,41.41716],[69.205575,41.458944],[69.21677,41.465685],[69.204809,41.475948],[69.146838,41.460069],[69.111259,41.480178],[69.072837,41.467402]]},
    {"code": "TM-UZ-KZ-A", "name": "Turkmaniston — O'zbekiston — Qozog'iston", "origin": "TM", "destination": "KZ", "entry": "06010", "exit": "35004", "color": "#60a5fa",
     "distance": 1104209, "duration": 130819,
     "waypoints": [[63.5141,39.1537],[64.46,39.77],[63.85,40.22],[59.60,42.46],[58.5986,43.1355]],
     "coords": [[63.514618,39.150282],[63.501116,39.12643],[63.562624,39.116542],[63.597814,39.22411],[63.713257,39.207322],[63.843481,39.504864],[63.973638,39.604064],[64.17068,39.679262],[64.20084,39.739493],[64.460344,39.770201],[64.177262,40.044306],[63.898135,40.147899],[63.845347,40.218771],[63.826776,40.259166],[63.782393,40.165918],[63.465173,40.137696],[62.995203,40.457605],[62.778258,40.575817],[62.664655,40.583799],[62.121845,40.994401],[61.978138,41.06005],[61.735239,41.276035],[61.546137,41.29462],[61.188159,41.415784],[61.039011,41.542312],[60.966755,41.55554],[60.952037,41.660314],[60.987158,41.688788],[60.902934,41.854929],[60.77351,41.941891],[60.401122,42.031978],[60.298783,42.212077],[60.173981,42.233155],[59.909285,42.398312],[59.649524,42.424398],[59.600105,42.459625],[59.459249,42.409643],[59.402466,42.42382],[59.071708,42.714848],[58.831725,43.051225],[58.617887,43.156483]]},
]


TASHKENT_JUNCTION = [69.279502, 41.149757]


def _split_at_tashkent(coords: list[list[float]]) -> tuple[list[list[float]], list[list[float]]]:
    index = min(range(len(coords)), key=lambda i: (coords[i][0] - TASHKENT_JUNCTION[0]) ** 2 + (coords[i][1] - TASHKENT_JUNCTION[1]) ** 2)
    return coords[: index + 1], coords[index:]


def _join(*segments: list[list[float]]) -> list[list[float]]:
    result: list[list[float]] = []
    for segment in segments:
        result.extend(segment if not result else segment[1:])
    return result


def _road_length(coords: list[list[float]]) -> int:
    total = 0.0
    for first, second in zip(coords, coords[1:], strict=False):
        lat1, lat2 = math.radians(first[1]), math.radians(second[1])
        dlat = lat2 - lat1
        dlng = math.radians(second[0] - first[0])
        value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
        total += 6371000 * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))
    return round(total)


def _derived_route(code: str, name: str, origin: str, destination: str, entry: str, exit: str, color: str, coords: list[list[float]]) -> dict:
    distance = _road_length(coords)
    return {
        "code": code, "name": name, "origin": origin, "destination": destination,
        "entry": entry, "exit": exit, "color": color, "distance": distance,
        "duration": round(distance / 15),
        "waypoints": [coords[0], TASHKENT_JUNCTION, coords[-1]], "coords": coords,
    }


for _base_route in ROUTES:
    _base_route["distance"] = _road_length(_base_route["coords"])
    _base_route["duration"] = round(_base_route["distance"] / 15)


_route_by_code = {route["code"]: route for route in ROUTES}
_dostlik_to_tashkent, _tashkent_to_ayritom = _split_at_tashkent(_route_by_code["KG-UZ-AF-A"]["coords"])
_gishtkoprik_to_tashkent, _tashkent_to_olot = _split_at_tashkent(_route_by_code["KZ-UZ-TM-A"]["coords"])
_oybek_to_tashkent, _tashkent_to_gishtkoprik = _split_at_tashkent(_route_by_code["TJ-UZ-KZ-A"]["coords"])
_dostlik_to_gishtkoprik = _join(_dostlik_to_tashkent, _tashkent_to_gishtkoprik)
_gishtkoprik_to_ayritom = _join(list(reversed(_tashkent_to_gishtkoprik)), _tashkent_to_ayritom)
_dostlik_to_olot = _join(_dostlik_to_tashkent, _tashkent_to_olot)

ROUTES.extend([
    _derived_route("CN-UZ-UA-A", "Xitoy — O'zbekiston — Ukraina", "CN", "UA", "03002", "27021", "#fb4058", _dostlik_to_gishtkoprik),
    _derived_route("RU-UZ-AF-A", "Rossiya — O'zbekiston — Afg'oniston", "RU", "AF", "27021", "22017", "#22d3ee", _gishtkoprik_to_ayritom),
    _derived_route("AF-UZ-RU-A", "Afg'oniston — O'zbekiston — Rossiya", "AF", "RU", "22017", "27021", "#38bdf8", list(reversed(_gishtkoprik_to_ayritom))),
    _derived_route("CN-UZ-TR-A", "Xitoy — O'zbekiston — Turkiya", "CN", "TR", "03002", "06010", "#f97316", _dostlik_to_olot),
    _derived_route("TR-UZ-CN-A", "Turkiya — O'zbekiston — Xitoy", "TR", "CN", "06010", "03002", "#a78bfa", list(reversed(_dostlik_to_olot))),
    _derived_route("AZ-UZ-KZ-A", "Ozarbayjon — O'zbekiston — Qozog'iston", "AZ", "KZ", "06010", "35004", "#34d399", _route_by_code["TM-UZ-KZ-A"]["coords"]),
    _derived_route("GE-UZ-KG-A", "Gruziya — O'zbekiston — Qirg'iziston", "GE", "KG", "06010", "03002", "#60a5fa", list(reversed(_dostlik_to_olot))),
    _derived_route("PK-UZ-KZ-A", "Pokiston — O'zbekiston — Qozog'iston", "PK", "KZ", "22017", "27021", "#e879f9", list(reversed(_gishtkoprik_to_ayritom))),
])

GATEWAYS = [
    ("CN", "Irkeshtam road gateway", "ORIGIN_GATEWAY", 39.7024, 73.9727, "KG", "Xitoy–Qirg'iziston avtomobil o'tish nuqtasi"),
    ("CN", "Torugart road gateway", "ORIGIN_GATEWAY", 40.5452, 75.3922, "KG", "Xitoy–Qirg'iziston xalqaro koridori"),
    ("RU", "Orenburg–Aqto'be gateway", "ORIGIN_GATEWAY", 51.1826, 57.0968, "KZ", "Rossiya–Qozog'iston avtomobil yo'li"),
    ("TR", "Kapıköy–Razi gateway", "DESTINATION_GATEWAY", 38.4497, 44.2886, "IR", "Turkiya–Eron avtomobil yo'li"),
]


async def seed_demo_declarations(db: AsyncSession, reset: bool = False) -> int:
    today = date.today()
    source_version = f"DEMO_V2_{today.year}"
    count = 10_000
    existing = await db.scalar(select(func.count()).select_from(TransitDeclaration).where(TransitDeclaration.source_system == source_version)) or 0
    if existing >= count and not reset:
        return existing
    await db.execute(delete(TransitDeclaration).where(or_(TransitDeclaration.source_system == "MOCK", TransitDeclaration.source_system.like("DEMO_V2%"))))
    rng = random.Random(20260811)
    start = date(today.year, 1, 1)
    pairs = [(r["origin"], r["destination"], r["entry"], r["exit"], max(5, 24 - index)) for index, r in enumerate(ROUTES)]
    batch: list[dict] = []
    for i in range(count):
        origin, destination, entry, exit, _ = rng.choices(pairs, weights=[p[4] for p in pairs], k=1)[0]
        day = start + timedelta(days=rng.randint(0, max(0, (today - start).days)))
        entry_dt = datetime.combine(day, time(rng.randint(0, 23), rng.randint(0, 59)), tzinfo=UTC)
        duration = rng.randint(2 * 60, 48 * 60)
        batch.append({
            "declaration_no": f"DEMO2-{today.year}-{i + 1:06d}", "source_system": source_version, "declaration_date": day,
            "origin_country_code": origin, "destination_country_code": destination, "entry_post_code": entry, "exit_post_code": exit,
            "entry_time": entry_dt, "exit_time": entry_dt + timedelta(minutes=duration), "vehicle_no": f"TEST-{rng.randint(1000,9999)}",
            "carrier_name": "Demo tashuvchi", "state": "COMPLETED",
        })
        if len(batch) == 500:
            await db.execute(insert(TransitDeclaration), batch)
            batch.clear()
    if batch:
        await db.execute(insert(TransitDeclaration), batch)
    return count


async def seed_all(db: AsyncSession) -> None:
    # This application currently manages the bootstrap administrator through
    # Render environment variables. Keep the single existing admin in sync so
    # changing those variables can recover access without editing password
    # hashes directly in Supabase.
    email = settings.admin_initial_email.strip().lower()
    user = await db.scalar(select(User).where(func.lower(User.email) == email))
    admin_action = "verified"
    if user is None:
        admins = (await db.scalars(select(User).where(User.role == "ADMIN").order_by(User.created_at))).all()
        if len(admins) == 1:
            user = admins[0]
            user.email = email
            admin_action = "email_updated"
        else:
            user = User(email=email, password_hash=hash_password(settings.admin_initial_password), role="ADMIN")
            db.add(user)
            admin_action = "created"
    else:
        user.email = email
    user.role = "ADMIN"
    user.is_active = True
    try:
        password_matches = verify_password(settings.admin_initial_password, user.password_hash)
    except Exception:
        password_matches = False
    if not password_matches:
        user.password_hash = hash_password(settings.admin_initial_password)
        admin_action = f"{admin_action}+password_updated"
    await logger.ainfo("admin_credentials_synchronized", action=admin_action)
    existing_posts = {post.post_code: post for post in (await db.scalars(select(CustomsPost))).all()}
    for code, name, post_type, country in POSTS:
        post = existing_posts.get(code)
        lat, lng = COORDINATES.get(code, (None, None))
        is_new = post is None
        if is_new:
            post = CustomsPost(post_code=code)
            db.add(post)
            post.is_active = True
        post.post_name = _official_post_name(code, name, post_type)
        post.post_type = post_type
        post.neighbor_country_code = country
        if lat is not None and (is_new or post.latitude is None or post.longitude is None):
            post.latitude = lat
            post.longitude = lng
            post.location_verified = True
            post.location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
    await db.flush()
    existing_gateways = set((await db.scalars(select(CountryGateway.name))).all())
    for country, name, gateway_type, lat, lng, neighbor, notes in GATEWAYS:
        if name in existing_gateways:
            continue
        gateway = CountryGateway(country_code=country, name=name, gateway_type=gateway_type, latitude=lat, longitude=lng,
            neighbor_country_code=neighbor, verified=True, is_active=True, notes=notes)
        gateway.location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
        db.add(gateway)
    await db.flush()
    # Seed code must never trigger relationship lazy-loading in an async
    # session. Waypoints are replaced explicitly below.
    existing_corridors = {
        corridor.code: corridor
        for corridor in (await db.scalars(select(Corridor).options(noload(Corridor.waypoints)))).all()
    }
    for priority, route in enumerate(ROUTES, start=1):
        geometry = {"type": "LineString", "coordinates": route["coords"]}
        corridor = existing_corridors.get(route["code"])
        if corridor is not None and corridor.geometry_source == "verified-osrm-seed-v2":
            continue
        if corridor is None:
            corridor = Corridor(code=route["code"])
            db.add(corridor)
        corridor.name = route["name"]
        corridor.origin_country_code = route["origin"]
        corridor.destination_country_code = route["destination"]
        corridor.entry_post_code = route["entry"]
        corridor.exit_post_code = route["exit"]
        corridor.status = "ACTIVE"
        corridor.color = route["color"]
        corridor.geometry_source = "verified-osrm-seed-v2"
        corridor.routing_provider = "osrm-seed-cache"
        corridor.geometry = ST_GeomFromGeoJSON(json.dumps(geometry))
        corridor.distance_meters = route["distance"]
        corridor.duration_seconds = route["duration"]
        corridor.route_needs_review = False
        corridor.priority = priority
        corridor.is_active = True
        await db.flush()
        await db.execute(
            delete(CorridorWaypoint)
            .where(CorridorWaypoint.corridor_id == corridor.id)
            .execution_options(synchronize_session=False)
        )
        for seq, coord in enumerate(route["waypoints"]):
            waypoint_type = "ENTRY_POST" if seq == 0 else "EXIT_POST" if seq == len(route["waypoints"]) - 1 else "VIA"
            wp = CorridorWaypoint(corridor_id=corridor.id, sequence_no=seq, waypoint_type=waypoint_type, latitude=coord[1], longitude=coord[0],
                post_code=route["entry"] if seq == 0 else route["exit"] if seq == len(route["waypoints"]) - 1 else None)
            wp.location = ST_SetSRID(ST_MakePoint(coord[0], coord[1]), 4326)
            db.add(wp)
    if settings.enable_demo_seed:
        await seed_demo_declarations(db)
    await db.commit()
