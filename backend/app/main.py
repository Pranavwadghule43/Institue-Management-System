import logging
import re
import time
import uuid

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from . import errors, security
from .common import request_ctx
from .config import settings
from .db import get_db
from .routers import academics, admin, bills, dashboard, enquiries, expenses, fees, finance, jobs, reports, services, students, whatsapp
from .timing import RequestTiming, current_timing

logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("ims.request")


class HideApiAccessLog(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # The request middleware already logs API calls using route templates.
        # Uvicorn's URL can include record IDs, search terms and webhook tokens.
        if isinstance(record.args, tuple) and len(record.args) == 5:
            return not record.args[2].startswith(settings.api_v1_prefix)
        return True


logging.getLogger("uvicorn.access").addFilter(HideApiAccessLog())

docs = settings.docs_enabled
app = FastAPI(title=settings.app_name, version="1.0.0", docs_url="/docs" if docs else None, redoc_url=None, openapi_url="/openapi.json" if docs else None)
errors.install(app)

SECURITY_HEADERS = {"X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
                    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"}


@app.middleware("http")
async def request_log(request: Request, call_next):
    """Correlation ID + route/method/status/duration + security headers. Never logs bodies or tokens."""
    supplied_id = request.headers.get("X-Request-ID", "")
    rid = supplied_id if re.fullmatch(r"[a-fA-F0-9]{32}", supplied_id) else uuid.uuid4().hex
    ctx_token = request_ctx.set((request.client.host if request.client else None, (request.headers.get("user-agent") or "")[:500]))
    timing = RequestTiming()
    timing_token = current_timing.set(timing)
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as e:  # Answer here so errors still pass through CORS and get the headers below.
        route = getattr(request.scope.get("route"), "path", "<unmatched>")
        errors.log_failure(log, f"unhandled error rid={rid} on {request.method} {route}", e)
        if errors.database_unavailable(e):
            response = JSONResponse(errors._body("DATABASE_UNAVAILABLE", "The service is temporarily unavailable. Please try again later."), status_code=503)
        else:
            response = JSONResponse(errors._body("INTERNAL_ERROR", "Something went wrong. Please try again."), status_code=500)
    finally:
        current_timing.reset(timing_token)
        request_ctx.reset(ctx_token)
    response.headers["X-Request-ID"] = rid
    response.headers.update(SECURITY_HEADERS)
    if request.url.path.startswith(settings.api_v1_prefix):
        response.headers.setdefault("Cache-Control", "no-store")  # financial / personal data must not be cached
    if settings.production:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    log.info("rid=%s method=%s endpoint=%s status=%s duration_ms=%.2f db_queries=%d db_ms=%.2f operations_ms=%s",
             rid, request.method, getattr(request.scope.get("route"), "path", "<unmatched>"), response.status_code,
             (time.perf_counter() - start) * 1000, timing.query_count, timing.query_ms,
             {name: round(ms, 2) for name, ms in timing.operations.items()})
    return response


# Added last so it runs first: CORS answers preflights before anything else.
app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_credentials=False, allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
                   allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID"], expose_headers=["X-Request-ID", "Content-Disposition", "Retry-After"],
                   max_age=600)


api = APIRouter(prefix=settings.api_v1_prefix)


@api.get("/health", tags=["system"])
def health():
    return {"status": "ok", "service": "ims-api"}


@api.get("/health/db", tags=["system"])
def health_db(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except Exception as e:
        errors.log_failure(log, "database health check failed", e)
        return JSONResponse({"status": "error", "service": "ims-api", "database": "unreachable"}, status_code=503)
    return {"status": "ok", "service": "ims-api", "database": "ok"}


for r in (security.router, academics.router, enquiries.router, students.router, fees.router, services.router, jobs.router, bills.router,
          expenses.router, finance.router, dashboard.router, reports.router, admin.router, whatsapp.router):
    api.include_router(r)
app.include_router(api)
