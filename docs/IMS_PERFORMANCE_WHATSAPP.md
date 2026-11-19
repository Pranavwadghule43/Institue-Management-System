# IMS performance and WhatsApp PDF delivery

## Database measurements

On the development machine, 12 warm `SELECT 1` calls to the existing Sydney Supabase session pooler had a 399.70 ms median and a 395.33–801.30 ms range. One cold SQLAlchemy checkout took 6,894 ms, including the pooler connection and initial driver setup. These were read-only probes. No lock wait or idle-in-transaction connection was visible in the sampled activity view.

The read-only `pg_stat_statements` sample contained 61 matching SELECT shapes and 292 executions across the principal IMS tables. Weighted mean PostgreSQL execution time was 0.304 ms and the highest per-shape mean was 51.225 ms. Live row estimates were small, including one student, two slots and two courses. The previous unscoped slot counter executed in 0.135 ms. The scoped query plan could use `idx_students_course_slot` for assignment counts. Its selected course had no matching active slot in that probe, so the count subplan did not run. The sample does not justify an additional index.

## Isolated API benchmark

Both checkouts used the same disposable PostgreSQL workload and the same installed dependencies. The baseline was `33f8af44dae5fb05460e32907f9516ec4dad72dd`. The data included 31 courses and batches, 31 subtype rows, 26 initial admissions with installment schedules, 38 enquiries and one service job and bill. A further 12 admissions and 12 payments ran at the end. Each row shows 10 measured HTTP calls through FastAPI TestClient after two warm-ups. SQL counts include authorization and the route's cursor executions. Local timings omit the Supabase network.

| Operation | Before median / p90 (ms) | After median / p90 (ms) | Median reduction | SQL before → after |
|---|---:|---:|---:|---:|
| Login | 52.79 / 61.47 | 52.82 / 53.85 | −0.1% | 7 → 3 |
| Admin dashboard | 24.96 / 26.42 | 26.64 / 27.51 | −6.7% | 11 → 7 |
| Course list | 11.00 / 11.33 | 10.90 / 12.50 | 0.9% | 5 → 2 |
| Course subtype lookup | 6.92 / 7.62 | 6.94 / 7.44 | −0.3% | 3 → 2 |
| Scoped time slots | 8.25 / 8.55 | 8.07 / 9.03 | 2.2% | 3 → 2 |
| Enquiry search | 13.27 / 15.97 | 14.73 / 15.94 | −11.0% | 7 → 4 |
| Student search | 18.89 / 21.46 | 16.12 / 17.63 | 14.7% | 5 → 4 |
| Student profile | 15.75 / 17.27 | 12.06 / 15.96 | 23.4% | 11 → 7 |
| Fee summary | 10.81 / 11.92 | 8.61 / 8.96 | 20.4% | 5 → 3 |
| Receipt print data | 8.10 / 8.89 | 7.79 / 8.42 | 3.8% | 2 → 2 |
| Customer list | 10.27 / 11.82 | 10.54 / 12.69 | −2.6% | 3 → 3 |
| Service jobs | 14.03 / 15.21 | 11.54 / 12.70 | 17.7% | 10 → 6 |
| Bill Desk detail | 11.40 / 12.20 | 11.02 / 11.84 | 3.3% | 9 → 6 |
| Expenses | 10.79 / 12.98 | 8.39 / 8.80 | 22.2% | 5 → 3 |
| Staff and account limits | 8.80 / 8.97 | 8.39 / 8.81 | 4.7% | 5 → 3 |
| Fee collection report | 11.23 / 14.36 | 11.02 / 14.81 | 1.9% | 3 → 3 |
| Admission with initial payment | 45.64 / 51.57 | 26.12 / 29.00 | 42.8% | 30 → 19 |
| Fee payment and receipt | 28.64 / 30.55 | 20.55 / 21.04 | 28.2% | 19 → 15 |

### Findings ranked by impact

1. **Supabase round trips dominated the measured database cost.** Admission reused its freshly created installment rows, payment reused its existing schedule and FIFO results, and public numbering moved from a locked read and separate update to an atomic PostgreSQL upsert. The numbering row stays in the business transaction. Login batches four successful-login writes and the permission lookup in one statement while keeping the account lock, password verification and failed-login checks. The dashboard combined ledger reads and joined actor names. Its localhost median and the enquiry median rose modestly even as SQL executions fell. These measurements quantify the reductions in network-bound work. Live authenticated route latency remains unmeasured. Hosting the API closer to the database would reduce the remaining network delay.
2. **Read views made extra lookup and aggregate calls.** Academic lookup joins and scoped counts removed three round trips from the course list and one each from course subtype and slot lookups. Admission uses the active subtypes already returned with the course. Student profile, service jobs, bills, expenses, enquiries and staff now reuse data from joined or combined queries. Service document upload runs its synchronous file and DB work in a worker thread. The customer list, receipt-data lookup and sampled report already used few statements. The benchmark did not establish a database bottleneck for those endpoints.
3. **The browser loaded all page code at sign-in.** Route-level imports keep the portal shell mounted and defer page and PDF code until needed. The minified entry bundle fell from 504.01 kB to 250.46 kB, a 50.3% reduction. Gzip fell from 141.39 kB to 79.64 kB, a 43.7% reduction. After sign-in the browser preloads the admission page during idle time for users with admission permission. Repeated manual PDF requests reuse the file generated for the same print-data object. Replacing that object invalidates the cached PDF.

Request logs now contain route templates, request IDs, wall time, SQL count and execution time, and named timings for password verification, automatic PDF generation and Meta upload/submission. They exclude request data, SQL values and raw API URLs.

## Browser benchmark

Five fresh Edge contexts per build alternated between the original and current frontend, using the same isolated backend, fixture and loopback connection. The timing starts at navigation or the user action and ends when the target control appears or the download begins.

| Browser operation | Before median (ms) | After median (ms) | Median reduction |
|---|---:|---:|---:|
| Sign-in page interactive | 165.88 | 159.12 | 4.1% |
| Sign-in submit to dashboard content | 257.77 | 279.32 | −8.4% |
| Warm signed-in shell to admission subtype controls | 123.66 | 116.04 | 6.2% |
| First manual receipt PDF | 729.18 | 674.62 | 7.5% |
| Same receipt PDF downloaded again | 541.99 | 54.09 | 90.0% |

Before admission was preloaded, a separate five-run comparison found 218.62 ms for the split route and 132.04 ms for the original build. In the final run the admission ranges were 117.96–138.15 ms before and 110.62–116.50 ms after. Sign-in to the dashboard varied from 240.88 to 890.35 ms before and 252.06 to 370.83 ms after, so the sample does not establish a dashboard speedup in the browser.

Edge verified Admin fixture login and dashboard, subtype pricing and batch selection, saving an admission, a paid bill, real PDF downloads, manual WhatsApp fallback and automatic receipt and paid-bill submission to the mock provider. The local production preview rendered the sign-in page.

## Code changed

- Backend core — `app/common.py`, `app/config.py`, `app/db.py`, `app/document_pdf.py`, `app/errors.py`, `app/ledger.py`, `app/main.py`, `app/models.py`, `app/security.py`, `app/timing.py`, `app/whatsapp_cloud.py`.
- Backend routes — `app/routers/academics.py`, `admin.py`, `bills.py`, `dashboard.py`, `enquiries.py`, `expenses.py`, `fees.py`, `jobs.py`, `students.py`, `whatsapp.py`.
- Schema and configuration — `backend/sql/2026-11-19_whatsapp_document_deliveries.sql`, `backend/pyproject.toml`, `backend/README.md`.
- Tests — `backend/tests/benchmark_ims.py`, `conftest.py`, `test_performance.py`, `test_whatsapp_delivery.py`.
- Frontend — `src/App.tsx`, `src/api/client.ts`, `src/app/AppShell.tsx`, `src/components/AutomaticWhatsApp.tsx`, `PrintDocs.tsx`, `SubtypeChecks.tsx`, `WhatsAppSend.tsx`, `src/pages/fees/FeeCollection.tsx`, `FeeFinance.tsx`, `src/pages/services/BillDesk.tsx`, `src/pages/students/Admission.tsx`.

## WhatsApp activation

The automatic receipt and paid-bill paths render server PDFs with the persisted document numbers and financial values and upload the actual PDF bytes to the official Meta Cloud API. The automatic PDFs use an A4 layout. The existing manual browser PDF and print layout use A5. The isolated tests inspect the uploaded PDF bytes and cover permissions, opt-in, the registered recipient, unchanged payment data, duplicate requests, safe retries, signed callbacks and status ordering.

Automatic delivery remains disabled until the Meta sending number, server secrets, two approved utility templates and public HTTPS webhook subscription are configured. Contact consent is confirmed by the operator for the number shown and recorded with each attempt. A real delivery check requires authorization for an eligible test number. See [backend configuration](../backend/README.md#automatic-whatsapp-pdfs) and [Meta Cloud API documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview).

## Verification

The full isolated backend suite passed 131 tests with five expected failures. The separately enabled read-only schema-drift test passed on Supabase. The known expected failures cover duplicate Aadhaar admission, cancellation accounting for paid bills, two installment date validations, and validation feedback for clearing a required customer field.

Supabase migration `20261119181440` is recorded on project `tiusjvbrbjsxfmvhursm`. The new table is owned by `postgres` and has row-level security enabled. The API roles and the developer database role have no read access. The table had zero delivery records at verification. The Supabase advisor notes that the table has no RLS policy, which is deliberate for owner-only access under the current configuration. [Supabase Data API security](https://supabase.com/docs/guides/api/securing-your-api)

The frontend tests passed 5/5 and the TypeScript production build succeeded. The live development backend returned HTTP 200 for application and database health, and accepted the exact frontend origin `http://localhost:5173`. An active, unlocked Admin account with a previous sign-in was confirmed through a read-only query. Browser authentication used the isolated Admin fixture because the live Admin password was unavailable.
