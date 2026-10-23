from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from .config import settings

# Supabase session pooler caps connections per role, so keep the pool small.
engine = create_engine(settings.database_url, pool_pre_ping=True, pool_size=5, max_overflow=5)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    # Services commit explicitly; anything uncommitted is rolled back on close.
    with SessionLocal() as db:
        yield db
