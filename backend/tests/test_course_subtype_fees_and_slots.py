from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy.exc import IntegrityError

from app.common import today
from app.db import engine
from conftest import admission_body, ok


def subtype(api, course, name, **fields):
    return ok(api.post(f"/courses/{course['id']}/subtypes", json={"name": name, **fields}), 201)


def slot_fields(course, **fields):
    return {"course_id": course["id"], "name": "Specialist batch", "start_time": "11:00",
            "end_time": "12:30", "capacity": 5, **fields}


def assert_error(response, status, code):
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code


def test_subtype_fee_can_be_set_edited_cleared_and_left_blank(admin, course):
    plain = subtype(admin, course, "Basic")
    priced = subtype(admin, course, "Advanced", fee="4000.25")
    assert plain["fee"] is None and priced["fee"] == "4000.25"
    url = f"/course-subtypes/{priced['id']}"
    assert ok(admin.patch(url, json={"name": "Advanced II"}))["fee"] == "4000.25"
    assert ok(admin.patch(url, json={"fee": "0"}))["fee"] == "0.00"
    courses = ok(admin.get("/courses"))
    assert courses[0]["fee"] == "7500.00"
    assert {s["id"]: s["fee"] for s in courses[0]["subtypes"]} == {plain["id"]: None, priced["id"]: "0.00"}
    assert ok(admin.patch(url, json={"fee": None}))["fee"] is None


@pytest.mark.parametrize("fee", ["-1", "unpriced", "0.001", "10000000000", "NaN"])
def test_invalid_subtype_fees_are_rejected(admin, course, fee):
    response = admin.post(f"/courses/{course['id']}/subtypes", json={"name": "Advanced", "fee": fee})
    assert_error(response, 422, "VALIDATION_ERROR")
    assert "fee" in response.json()["error"]["field_errors"]
    existing = subtype(admin, course, "Advanced", fee="4000")
    assert_error(admin.patch(f"/course-subtypes/{existing['id']}", json={"fee": fee}), 422, "VALIDATION_ERROR")


def test_time_slot_assignment_is_optional_and_course_specific(admin, course):
    a = subtype(admin, course, "Basic")
    b = subtype(admin, course, "Advanced")
    other = ok(admin.post("/courses", json={"code": "OTHER", "name": "Other course", "duration_months": 3, "fee": "3000"}), 201)
    foreign = subtype(admin, other, "Unrelated")
    offered = ok(admin.get(f"/courses/{course['id']}/subtypes"))
    assert {item["id"] for item in offered} == {a["id"], b["id"]}
    assert_error(admin.post("/time-slots", json=slot_fields(course, course_subtype_id=foreign["id"])), 400, "SUBTYPE_MISMATCH")
    slot = ok(admin.post("/time-slots", json=slot_fields(course, course_subtype_id=a["id"])), 201)
    assert slot["course_subtype"] == {"id": a["id"], "name": "Basic"}
    path = f"/time-slots/{slot['id']}"
    assert ok(admin.patch(path, json={"course_subtype_id": b["id"]}))["course_subtype_id"] == b["id"]
    assert_error(admin.patch(path, json={"course_subtype_id": foreign["id"]}), 400, "SUBTYPE_MISMATCH")
    ok(admin.post(f"/course-subtypes/{a['id']}/deactivate"))
    assert_error(admin.patch(path, json={"course_subtype_id": a["id"]}), 400, "SUBTYPE_MISMATCH")
    assert ok(admin.patch(path, json={"course_subtype_id": None}))["course_subtype"] is None
    course_slots = ok(admin.get("/time-slots", params={"course_id": course["id"]}))
    assert all(item["course_subtype_id"] is None for item in course_slots)


def test_admission_and_student_changes_enforce_slot_eligibility_and_keep_pricing(admin, course, enquiry):
    a = subtype(admin, course, "Basic", fee="3100.15")["id"]
    b = subtype(admin, course, "Advanced", fee="4900.00")["id"]
    c = subtype(admin, course, "Third")["id"]
    assigned = ok(admin.post("/time-slots", json=slot_fields(course, course_subtype_id=b)), 201)["id"]
    incompatible = ok(admin.post("/time-slots", json=slot_fields(course, name="Third batch", course_subtype_id=c)), 201)["id"]
    conversion = f"/enquiries/{enquiry['code']}/convert"
    for ids in ([], [a]):
        response = admin.post(conversion, json=admission_body(course, course_subtype_ids=ids, time_slot_id=assigned))
        assert_error(response, 400, "TIME_SLOT_SUBTYPE_MISMATCH")
    custom = [{"due_date": (today() + timedelta(days=30)).isoformat(), "amount": "7250.15"}]
    result = ok(admin.post(conversion, json=admission_body(
        course, course_subtype_ids=[a, b], time_slot_id=assigned, discount="250", installments=custom,
    )), 201)
    code = result["student"]["code"]
    assert result["fees"]["agreed_fee"] == "8000.15"
    assert result["fees"]["net_fee"] == "7750.15" and result["fees"]["balance"] == "7250.15"
    receipt = result["receipt"]
    receipt_path = f"/receipts/{receipt['receipt_no']}"

    assert_error(admin.patch(f"/students/{code}", json={"course_subtype_ids": [a]}), 400, "TIME_SLOT_SUBTYPE_MISMATCH")
    assert_error(admin.post(f"/students/{code}/change-time-slot", json={"time_slot_id": incompatible}), 400, "TIME_SLOT_SUBTYPE_MISMATCH")
    assert_error(admin.patch(f"/time-slots/{assigned}", json={"course_subtype_id": c}), 409, "TIME_SLOT_SUBTYPE_IN_USE")
    assert ok(admin.patch(f"/time-slots/{assigned}", json={"course_subtype_id": a}))["course_subtype_id"] == a
    ok(admin.post(f"/students/{code}/change-time-slot", json={"time_slot_id": course["slot"]["id"]}))
    ok(admin.patch(f"/students/{code}", json={"course_subtype_ids": [a]}))
    ok(admin.patch(f"/course-subtypes/{a}", json={"fee": "9800.00"}))
    summary = ok(admin.get(f"/fees/students/{code}/summary"))
    assert {key: summary[key] for key in result["fees"]} == result["fees"]
    assert ok(admin.get(receipt_path))["snapshot"] == receipt["snapshot"]


def test_existing_course_and_batch_permissions_still_apply(admin, course, make_staff):
    viewer = make_staff(["students.view"])
    batch_manager = make_staff(["batches.manage"])
    course_manager = make_staff(["courses.manage"])
    path = f"/courses/{course['id']}/subtypes"
    assert viewer.get(path).status_code == 200
    assert viewer.post(path, json={"name": "Denied", "fee": "25"}).status_code == 403
    assert batch_manager.post(path, json={"name": "Denied", "fee": "25"}).status_code == 403
    priced = subtype(course_manager, course, "Permitted", fee="25")
    assert viewer.post("/time-slots", json=slot_fields(course)).status_code == 403
    created = ok(batch_manager.post("/time-slots", json=slot_fields(course, course_subtype_id=priced["id"])), 201)
    assert ok(batch_manager.patch(f"/time-slots/{created['id']}", json={"course_subtype_id": None}))["course_subtype"] is None


def test_migration_preserves_legacy_rows_and_rejects_invalid_data():
    migration = Path(__file__).parents[1] / "sql" / "2026-11-19_course_subtype_fees_and_time_slots.sql"
    with engine.connect() as conn:
        conn.exec_driver_sql("""
            CREATE SCHEMA subtype_migration_test;
            CREATE TABLE subtype_migration_test.course_subtypes (id bigint PRIMARY KEY, course_id bigint NOT NULL);
            CREATE TABLE subtype_migration_test.time_slots (id bigint PRIMARY KEY, course_id bigint NOT NULL);
            ALTER TABLE subtype_migration_test.course_subtypes ENABLE ROW LEVEL SECURITY;
            ALTER TABLE subtype_migration_test.time_slots ENABLE ROW LEVEL SECURITY;
            INSERT INTO subtype_migration_test.course_subtypes VALUES (12, 1), (34, 2);
            INSERT INTO subtype_migration_test.time_slots VALUES (56, 1);
        """)
        conn.exec_driver_sql(migration.read_text().replace("public.", "subtype_migration_test."))
        assert conn.exec_driver_sql("SELECT id, fee FROM subtype_migration_test.course_subtypes ORDER BY id").all() == [(12, None), (34, None)]
        assert conn.exec_driver_sql("SELECT id, course_subtype_id FROM subtype_migration_test.time_slots").all() == [(56, None)]
        assert conn.exec_driver_sql("SELECT count(*) FROM pg_tables WHERE schemaname='subtype_migration_test' AND rowsecurity").scalar_one() == 2
        conn.exec_driver_sql("UPDATE subtype_migration_test.time_slots SET course_subtype_id=12 WHERE id=56")
        with pytest.raises(IntegrityError), conn.begin_nested():
            conn.exec_driver_sql("UPDATE subtype_migration_test.time_slots SET course_subtype_id=34 WHERE id=56")
        with pytest.raises(IntegrityError), conn.begin_nested():
            conn.exec_driver_sql("UPDATE subtype_migration_test.course_subtypes SET fee=-0.01 WHERE id=12")
