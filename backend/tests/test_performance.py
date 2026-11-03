"""Performance guards (3 Nov 2026): keep database round trips per request low.

Pranav's report: every screen slow on Supabase. Cause: each database query is a network round trip (50-300 ms), and
some screens issued one query per row (N+1). These tests count SQL statements per request so that a future change
can't quietly bring the slowness back. They check the NUMBER of queries only; results are covered by the other tests.
"""
from contextlib import contextmanager

import pytest
from sqlalchemy import event

from app.db import engine
from conftest import admission_body, ok


@contextmanager
def count_queries():
    seen: list[str] = []

    def on_query(conn, cursor, statement, params, context, executemany):
        seen.append(statement)
    event.listen(engine, "before_cursor_execute", on_query)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", on_query)


def _enquiries(admin, course, n, start):
    for i in range(start, start + n):
        ok(admin.post("/enquiries", json={"student_name": f"Perf Student {i}", "mobile": f"98765{i:05d}", "course_id": course["id"]}), 201)


def test_signed_in_request_checks_session_and_permissions_in_one_query(admin):
    with count_queries() as q:
        ok(admin.get("/auth/me"))
    assert len(q) == 1, q  # session + user + permissions together (was 2 queries + a connection ping)


def test_enquiry_list_queries_do_not_grow_with_rows(admin, course):
    _enquiries(admin, course, 3, 0)
    e = ok(admin.get("/enquiries", params={"page_size": 50}))["items"][0]
    ok(admin.post(f"/enquiries/{e['code']}/convert", json=admission_body(course, full_name=e["student_name"], mobile=e["mobile"])), 201)
    with count_queries() as small:
        page = ok(admin.get("/enquiries", params={"page_size": 50}))
    assert page["total"] == 3 and any(i["student_code"] for i in page["items"])
    _enquiries(admin, course, 15, 100)
    with count_queries() as big:
        assert ok(admin.get("/enquiries", params={"page_size": 50}))["total"] == 18
    assert len(big) == len(small), f"{len(small)} queries for 3 rows but {len(big)} for 18 rows: a per-row query (N+1) is back"


@pytest.mark.parametrize("path,limit", [("/dashboard/admin", 12), ("/meta/sidebar", 2), ("/meta/notifications", 4),
                                        ("/fees/reminders", 5), ("/expenses/summary", 3)])
def test_dashboard_and_badges_stay_within_query_budget(admin, student, path, limit):
    with count_queries() as q:
        ok(admin.get(path))
    assert len(q) <= limit, f"{path}: {len(q)} queries (budget {limit})"
