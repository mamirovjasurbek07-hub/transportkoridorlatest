import asyncio
import time
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

import structlog
import asyncpg
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, ORJSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy import delete, select
from sqlalchemy.exc import SQLAlchemyError

from app.api.router import api_router
from app.audit import audit_record, client_ip
from app.config import settings
from app.database import SessionLocal
from app.models import AuditLog
from app.jobs import run_route_rebuild, unfinished_route_job_ids
from app.monitoring import record_request
from app.routing import close_routing_http_client
from app.seed import ensure_initial_admin, seed_all

structlog.configure(processors=[structlog.processors.TimeStamper(fmt="iso"), structlog.processors.JSONRenderer()])
logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with SessionLocal() as db:
        if settings.seed_on_startup:
            await seed_all(db)
        else:
            await ensure_initial_admin(db)
    recovered_jobs = await unfinished_route_job_ids()
    recovery_tasks = [asyncio.create_task(run_route_rebuild(job_id)) for job_id in recovered_jobs]
    try:
        yield
    finally:
        for task in recovery_tasks:
            if not task.done():
                task.cancel()
        if recovery_tasks:
            await asyncio.gather(*recovery_tasks, return_exceptions=True)
        await close_routing_http_client()


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
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=5)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
    request.state.request_id = request_id
    started = time.perf_counter()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        response.headers["X-Request-ID"] = request_id
        return response
    finally:
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        record_request(request.url.path, status_code, duration_ms)
        await logger.ainfo("request", request_id=request_id, method=request.method, path=request.url.path, status=status_code, duration_ms=duration_ms)


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    code = {401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 422: "VALIDATION_ERROR"}.get(exc.status_code, "REQUEST_ERROR")
    return ORJSONResponse(status_code=exc.status_code, content={"error": {"code": code, "message": str(exc.detail), "details": {}}})


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    return ORJSONResponse(status_code=422, content={"error": {"code": "VALIDATION_ERROR", "message": "Kiritilgan ma'lumotlarni tekshiring", "details": {"fields": jsonable_encoder(exc.errors())}}})


def database_error_reason(exc: Exception) -> str:
    message = str(exc).lower()
    if "tenant/user" in message and "not found" in message:
        return "supabase_pooler_tenant_not_found"
    if "password authentication failed" in message:
        return "database_authentication_failed"
    if "timeout" in message:
        return "database_timeout"
    return "database_connection_failed"


async def database_unavailable(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    await logger.aerror(
        "database_unavailable",
        request_id=request_id,
        path=request.url.path,
        error=type(exc).__name__,
        reason=database_error_reason(exc),
    )
    return ORJSONResponse(
        status_code=503,
        headers={"Retry-After": "10", "X-Request-ID": request_id},
        content={
            "error": {
                "code": "DATABASE_UNAVAILABLE",
                "message": "Ma'lumotlar bazasiga ulanib bo'lmadi. Iltimos, birozdan so'ng qayta urinib ko'ring.",
                "details": {"request_id": request_id},
            }
        },
    )


app.add_exception_handler(SQLAlchemyError, database_unavailable)
app.add_exception_handler(asyncpg.PostgresError, database_unavailable)


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    await logger.aerror("unhandled_error", request_id=request_id, path=request.url.path, error=type(exc).__name__)
    return ORJSONResponse(
        status_code=500,
        headers={"X-Request-ID": request_id},
        content={"error": {"code": "INTERNAL_ERROR", "message": "Tizimda kutilmagan xato yuz berdi", "details": {"request_id": request_id}}},
    )


app.include_router(api_router, prefix="/api")


frontend_dist = (Path(__file__).resolve().parent.parent / "frontend_dist").resolve()


async def record_page_visit(action: str, path: str, ip_address: str | None, user_agent: str, request_id: str) -> None:
    try:
        async with SessionLocal() as db:
            cutoff = datetime.now(UTC) - timedelta(minutes=settings.public_visit_dedupe_minutes)
            duplicate = await db.scalar(
                select(AuditLog.id).where(
                    AuditLog.action == action,
                    AuditLog.ip_address == ip_address,
                    AuditLog.user_agent == user_agent,
                    AuditLog.created_at >= cutoff,
                ).limit(1)
            )
            if duplicate:
                return
            retention_cutoff = datetime.now(UTC) - timedelta(days=settings.audit_retention_days)
            await db.execute(delete(AuditLog).where(AuditLog.created_at < retention_cutoff))
            db.add(
                audit_record(
                    action,
                    "page",
                    path,
                    ip_address,
                    user_agent,
                    after={"request_id": request_id},
                )
            )
            await db.commit()
    except Exception as exc:
        await logger.awarning("page_visit_log_failed", path=path, error=type(exc).__name__)


@app.head("/", include_in_schema=False)
async def head_root() -> Response:
    return Response(status_code=200)


@app.get("/{full_path:path}", include_in_schema=False)
async def frontend(full_path: str, request: Request, background_tasks: BackgroundTasks):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Endpoint topilmadi")
    is_admin_page = full_path == "admin" or full_path.startswith("admin/")
    if full_path == "" or is_admin_page:
        background_tasks.add_task(
            record_page_visit,
            "ADMIN_PAGE_VISIT" if is_admin_page else "PUBLIC_VISIT",
            request.url.path,
            client_ip(request),
            request.headers.get("user-agent", "")[:255],
            getattr(request.state, "request_id", "")[:100],
        )
    requested = (frontend_dist / full_path).resolve()
    if frontend_dist in requested.parents and requested.is_file():
        response = FileResponse(requested)
        if full_path.startswith("assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "public, max-age=3600"
        return response
    index = frontend_dist / "index.html"
    if index.is_file():
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    return {"name": settings.app_name, "api": "/api/health"}
