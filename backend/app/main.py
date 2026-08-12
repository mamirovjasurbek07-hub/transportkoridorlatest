import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import structlog
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, ORJSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.api.router import api_router
from app.config import settings
from app.database import SessionLocal
from app.seed import seed_all

structlog.configure(processors=[structlog.processors.TimeStamper(fmt="iso"), structlog.processors.JSONRenderer()])
logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with SessionLocal() as db:
        await seed_all(db)
    yield


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    default_response_class=ORJSONResponse,
    docs_url="/api/docs" if settings.app_env != "production" else None,
    openapi_url="/api/openapi.json" if settings.app_env != "production" else None,
    lifespan=lifespan,
)
app.state.limiter = Limiter(key_func=get_remote_address)
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token", "X-Request-ID"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
    started = time.perf_counter()
    response = await call_next(request)
    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    response.headers["X-Request-ID"] = request_id
    await logger.ainfo("request", request_id=request_id, method=request.method, path=request.url.path, status=response.status_code, duration_ms=duration_ms)
    return response


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    code = {401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 422: "VALIDATION_ERROR"}.get(exc.status_code, "REQUEST_ERROR")
    return ORJSONResponse(status_code=exc.status_code, content={"error": {"code": code, "message": str(exc.detail), "details": {}}})


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    return ORJSONResponse(status_code=422, content={"error": {"code": "VALIDATION_ERROR", "message": "Kiritilgan ma'lumotlarni tekshiring", "details": {"fields": jsonable_encoder(exc.errors())}}})


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception):
    await logger.aerror("unhandled_error", path=request.url.path, error=type(exc).__name__)
    return ORJSONResponse(status_code=500, content={"error": {"code": "INTERNAL_ERROR", "message": "Tizimda kutilmagan xato yuz berdi", "details": {}}})


app.include_router(api_router, prefix="/api")


frontend_dist = (Path(__file__).resolve().parent.parent / "frontend_dist").resolve()


@app.get("/{full_path:path}", include_in_schema=False)
async def frontend(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Endpoint topilmadi")
    requested = (frontend_dist / full_path).resolve()
    if frontend_dist in requested.parents and requested.is_file():
        return FileResponse(requested)
    index = frontend_dist / "index.html"
    if index.is_file():
        return FileResponse(index)
    return {"name": settings.app_name, "api": "/api/health"}
