import logging
import time
import uuid

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from . import errors, security
from .common import request_ctx
from .config import settings
from .db import get_db
from .routers import academics, admin, bills, dashboard, enquiries, expenses, fees, finance, jobs, reports, services, students

logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("ims.request")

app = FastAPI(title=settings.app_name, version="1.0.0",
              docs_url="/docs" if settings.expose_docs else None, redoc_url=None, openapi_url="/openapi.json" if settings.expose_docs else None)
errors.install(app)
app.add_middleware(CORSMiddleware, allow_origins=[settings.frontend_origin], allow_credentials=True, allow_methods=["*"],
                   allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID"], expose_headers=["X-Request-ID", "Content-Disposition"])


@app.middleware("http")
async def request_log(request: Request, call_next):
    """Correlation ID + route/method/status/duration. Never logs bodies, tokens or Aadhaar."""
    rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:16]
    request_ctx.set((request.client.host if request.client else None, (request.headers.get("user-agent") or "")[:500]))
    start = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    log.info("rid=%s %s %s %s %.0fms", rid, request.method, request.url.path, response.status_code, (time.perf_counter() - start) * 1000)
    return response


api = APIRouter(prefix=settings.api_v1_prefix)


@api.get("/health", tags=["system"])
def health():
    return {"status": "ok", "service": "ims-api"}


@api.get("/health/db", tags=["system"])
def health_db(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        log.exception("database health check failed")
        return {"status": "error", "service": "ims-api", "database": "unreachable"}
    return {"status": "ok", "service": "ims-api", "database": "ok"}


for r in (security.router, academics.router, enquiries.router, students.router, fees.router, services.router, jobs.router, bills.router,
          expenses.router, finance.router, dashboard.router, reports.router, admin.router):
    api.include_router(r)
app.include_router(api)
