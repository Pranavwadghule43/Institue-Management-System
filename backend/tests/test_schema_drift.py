"""Compare ORM models with the live shared schema (read-only reflection).

Runs only when IMS_LIVE_DATABASE_URL is set, e.g. the Supabase URL from .env.
"""
import os

import pytest
from sqlalchemy import MetaData, create_engine

from app.models import Base

LIVE = os.environ.get("IMS_LIVE_DATABASE_URL")


def _norm(t, dialect) -> str:
    return str(t.compile(dialect=dialect)).upper().replace("CHARACTER VARYING", "VARCHAR")


@pytest.mark.skipif(not LIVE, reason="IMS_LIVE_DATABASE_URL not set")
def test_models_match_live_schema():
    engine = create_engine(LIVE, execution_options={"postgresql_readonly": True})
    live = MetaData()
    live.reflect(engine, schema="public")
    problems = []
    live_tables = {t.name: t for t in live.tables.values()}
    assert set(Base.metadata.tables) == set(live_tables), set(Base.metadata.tables) ^ set(live_tables)
    for name, model in Base.metadata.tables.items():
        real = live_tables[name]
        if set(model.c.keys()) != set(real.c.keys()):
            problems.append(f"{name}: columns differ {set(model.c.keys()) ^ set(real.c.keys())}")
            continue
        for col in model.c:
            rc = real.c[col.name]
            if col.nullable != rc.nullable:
                problems.append(f"{name}.{col.name}: nullable model={col.nullable} live={rc.nullable}")
            mt, lt = _norm(col.type, engine.dialect), _norm(rc.type, engine.dialect)
            if mt != lt:
                problems.append(f"{name}.{col.name}: type model={mt} live={lt}")
    engine.dispose()
    assert not problems, "\n".join(problems)
