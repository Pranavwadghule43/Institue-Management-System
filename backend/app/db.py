import time
from collections.abc import Iterator

from sqlalchemy import create_engine, event, exc
from sqlalchemy.orm import Session, sessionmaker

from .config import settings
from .timing import current_timing

# Supabase session pooler caps connections per role, so keep the pool small.
engine = create_engine(settings.database_url, pool_size=5, max_overflow=5, hide_parameters=True)
SessionLocal = sessionmaker(engine, expire_on_commit=False)

# Liveness check only for connections that sat idle (performance): pool_pre_ping pinged on EVERY request, costing one
# extra database round trip each time (~50-300 ms to a remote Supabase). A connection used moments ago is alive; one
# idle longer than this is pinged first, and a dead one is replaced transparently, exactly as pre_ping did.
IDLE_PING_SECONDS = 15


@event.listens_for(engine, "checkin")
def _mark_idle(dbapi_connection, record) -> None:
    record.info["idle_since"] = time.monotonic()


@event.listens_for(engine, "checkout")
def _ping_if_idle(dbapi_connection, record, proxy) -> None:
    since = record.info.get("idle_since")
    if since is None or time.monotonic() - since < IDLE_PING_SECONDS:
        return  # brand-new connection, or one that was in use seconds ago
    try:
        alive = engine.dialect.do_ping(dbapi_connection)
    except Exception as e:  # dropped by the server/pooler while idle: the pool discards it and opens a fresh one
        raise exc.DisconnectionError() from e
    if not alive:
        raise exc.DisconnectionError()


@event.listens_for(engine, "before_cursor_execute")
def _start_query(conn, cursor, statement, parameters, context, executemany):
    if timing := current_timing.get():
        timing.query_count += 1
        context.ims_query_start = time.perf_counter()


def _finish_query(context):
    if context is not None and (start := getattr(context, "ims_query_start", None)) is not None:
        if timing := current_timing.get():
            timing.query_ms += (time.perf_counter() - start) * 1000


@event.listens_for(engine, "after_cursor_execute")
def _succeeded(conn, cursor, statement, parameters, context, executemany):
    _finish_query(context)


@event.listens_for(engine, "handle_error")
def _failed(exception_context):
    _finish_query(exception_context.execution_context)


def get_db() -> Iterator[Session]:
    # Services commit explicitly; anything uncommitted is rolled back on close.
    with SessionLocal() as db:
        yield db
