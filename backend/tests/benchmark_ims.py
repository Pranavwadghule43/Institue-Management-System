"""Run with pytest -q -s tests/benchmark_ims.py. Uses only the disposable IMS fixture."""
from contextlib import contextmanager
from statistics import median, quantiles
from time import perf_counter

from sqlalchemy import event

from conftest import PASSWORD, admission_body, ok
from app.common import today
from app.db import engine


def test_benchmark(admin, client, course, student, catalog, job):
    student_code = student["student"]["code"]
    day = today().isoformat()
    ok(admin.post(f"/courses/{course['id']}/subtypes", json={"name": "Benchmark Core", "fee": 7500}), 201)
    for n in range(30):
        extra = ok(admin.post("/courses", json={
            "code": f"bench{n}", "name": f"Benchmark Course {n}", "duration_months": 6, "fee": 7500,
        }), 201)
        ok(admin.post(f"/courses/{extra['id']}/subtypes", json={"name": "Core", "fee": 7500}), 201)
        ok(admin.post("/time-slots", json={
            "course_id": extra["id"], "name": f"Group {n}", "start_time": "08:00", "end_time": "09:30", "capacity": 30,
        }), 201)
    enquiries = []
    for n in range(37):
        row = ok(admin.post("/enquiries", json={
            "student_name": f"Benchmark Student {n}", "mobile": str(9000000000 + n), "course_id": course["id"],
        }), 201)
        payload = admission_body(course, full_name=f"Benchmark Student {n}", mobile=str(9000000000 + n))
        if n < 25:
            ok(admin.post(f"/enquiries/{row['code']}/convert", json=payload), 201)
        else:
            enquiries.append((row["code"], payload))
    admissions = iter(enquiries)
    bill = ok(admin.post("/service-bills", json={"job_code": job["code"], "items": [{"service_id": catalog["pan"]["id"], "quantity": 1}]}), 201)
    receipt = ok(admin.get("/receipts"))["items"][0]["receipt_no"]
    count = 0

    def count_sql(*args):
        nonlocal count
        count += 1

    def admit():
        code, payload = next(admissions)
        return admin.post(f"/enquiries/{code}/convert", json=payload)

    def pay():
        return admin.post(f"/fees/students/{student_code}/payments", json={"amount": 10, "payment_mode": "Cash"})

    paths = {
        "dashboard": "/dashboard/admin", "courses": "/courses", "subtypes": f"/courses/{course['id']}/subtypes",
        "slots": f"/time-slots?course_id={course['id']}", "enquiries": "/enquiries?q=Benchmark",
        "students": "/students?q=Benchmark", "profile": f"/students/{student_code}/profile",
        "fees": f"/fees/students/{student_code}/summary", "receipt": f"/receipts/{receipt}/print-data",
        "customers": "/customers", "jobs": "/service-jobs", "bills": f"/service-bills/{bill['code']}",
        "expenses": "/expenses", "staff": "/staff", "reports": f"/reports/fee-collection?date_from={day}&date_to={day}",
    }
    tasks = {name: (lambda path=path: admin.get(path), 200) for name, path in paths.items()}
    tasks["login"] = (lambda: client.post("/api/v1/auth/login", json={"username": "admin", "password": PASSWORD}), 200)
    tasks["admission"], tasks["fee_payment"] = (admit, 201), (pay, 201)
    with event_registration(engine, count_sql):
        for name, (request, status) in tasks.items():
            times, counts = [], []
            for run in range(12):
                count = 0
                start = perf_counter()
                response = request()
                elapsed = (perf_counter() - start) * 1000
                assert response.status_code == status, response.text
                if run >= 2:
                    times.append(elapsed)
                    counts.append(count)
            p90 = quantiles(times, n=10, method="inclusive")[8]
            print(f"BENCH {name:12} median={median(times):7.2f}ms p90={p90:7.2f}ms sql={median(counts):4.1f} bytes={len(response.content)}")


@contextmanager
def event_registration(engine, callback):
    event.listen(engine, "before_cursor_execute", callback)
    try:
        yield
    finally:
        event.remove(engine, "before_cursor_execute", callback)
