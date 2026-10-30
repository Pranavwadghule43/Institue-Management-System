# Updaate Computers — Institute Management System

React 18 + TypeScript + Vite front-end backed by the FastAPI API in [backend/](backend/README.md).
All data comes from the server (no demo or sample data in the app). Money, totals, IDs and permissions are decided by the API.

## Run

```bash
# 1. API - run from backend/ (see backend/README.md for setup, seeding and the single Admin account)
cd backend
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000   # Linux/macOS: .venv/bin/python

# 2. Web app - run from frontend/ (package.json lives there; Vite reads .env from frontend/)
cd frontend
cp ../.env.example .env   # VITE_API_URL=http://localhost:8000/api/v1
npm install
npm run dev            # http://localhost:5173
npm run build          # type-check + production build -> frontend/dist/
npm test
```

Sign in with a real account: the one Admin (created with `python -m app.cli create-admin`) and up to 4 Staff accounts the Admin creates
under Administration -> Staff. Each staff member sees only what the Admin grants on the Permissions page; the API enforces the same rules.

Receipts and service bills print on two sides (front + back) from the institute's paper templates: fee receipt on A5 landscape,
service bill on A5 portrait (`src/components/PrintDocs.tsx`, `src/styles/print.css`).

## Screens (UX-001 … UX-027)

| Area | Routes |
|---|---|
| Login | `/login` |
| Dashboard | `/` — 8 required KPIs, quick actions, income trend, service desk, fee follow-ups, activity |
| Students | `/students`, `/enquiries`, `/enquiries/new`, `/enquiries/:id`, `/students/new?enquiry=…`, `/students/:id` |
| Academics | `/academics/courses` (includes scheduled time slots) |
| Student finance | `/fees/collect`, `/fees/payments`, `/fees/receipts`, `/fees/receipts/:no`, `/fees/reminders` |
| Services | `/services/jobs` (board + list), `/services/jobs/:id`, `/services/customers`, `/services/customers/:id`, `/services/bills`, `/services/bills/new`, `/services/bills/:id` (Bill desk), `/services/master` |
| Money | `/expenses`, `/finance/daily-cash`, `/finance/pnl`, `/reports`, `/reports/:slug` (all 25 reports) |
| Administration | `/admin/staff`, `/admin/permissions`, `/admin/audit`, `/admin/backup`, `/admin/settings` |

States covered: loading skeletons, empty, no-results, inline validation, success toasts, confirmations
(showing amount + entity for money actions), permission denied, not found. Dark mode, Ctrl/⌘ + K search,
collapsible sidebar, print-ready receipts and bills.

**Phase 1 is laptop/PC only** (min width 1280px). Tablet/mobile rules are parked in `src/styles/responsive.css`
(not imported) — instructions to enable them are at the top of that file.

## Admin and Staff views

- **Admin** sees the full dashboard (institute-wide KPIs, income trend, service desk, follow-ups, activity) and Administration.
- **Staff** get *My counter*: fees they collected today, service bills they closed, jobs assigned to them, cash to hand over,
  their receipts, their recent entries and a *My access* panel showing what the Admin has allowed. Menus and actions
  follow the per-user permissions set on the Permissions page; the job board opens on "assigned to me".

## WhatsApp (FR-030 / C-56)

Receipts and service bills have **Send on WhatsApp**: a dialog with the customer's number and the complete receipt/bill
as a formatted message, plus a live chat preview. *Open WhatsApp* uses `wa.me` to open that chat with the message typed in —
the user presses Send (no automated API, per C-56). A PDF can be attached manually via *Save PDF*. After a bill is paid
the dialog opens automatically. Each open is written to the audit log.

## Bill desk (UX-016 / UX-017)

Items on the left, the bill exactly as it prints on the right — both update together.

- **Add:** type in the search box and press Enter. Adding the same item again raises its quantity.
- **Update:** − / + quantity stepper, or the pencil to change the service, quantity and (Admin only) rate. Overridden rates are flagged and audited.
- **Delete:** bin icon, with an Undo bar for 7 seconds.
- Fixed-amount discount, full payment only, paid bills locked. A correction is an Admin cancellation (reason + typed bill number) followed by a replacement bill.
- Portal user name / password for the customer can be typed for printing; they are never sent to the server.

## Aligned with the specification

- Student status Active / Completed / Left (FR-006); Aadhaar searchable (FR-036).
- Payment modes Cash, GPay, PhonePe, other UPI, Card, Bank transfer (BR-005).
- Service job status changes follow WF-07 (Completed and Cancelled are final).
- P&L for today, week, month, financial year and custom range (FR-032).
- Sign-in throttled after 5 failed attempts (FR-003); generic error text (M01).

## Handoff

`handoff/` holds the packages for colleagues — source code zip, Figma import zip (33 editable SVG screens + PNGs +
design tokens). See `handoff/HANDOFF.md`.

## Structure

```
src/
├─ api/            client.ts (fetch, auth token, useQuery, write/refresh), types.ts (API shapes)
├─ app/            AppContext (signed-in user, permissions, theme, toasts), AppShell (sidebar, topbar, command palette), nav
├─ components/     ui.tsx (Badge/Modal/Drawer/Table helpers/Field/MoneyInput…), BarChart.tsx, PayModePicker.tsx, PrintDocs.tsx (receipt + bill templates)
├─ lib/            format.ts (₹ Indian grouping, dates), whatsapp.ts (wa.me links), payModes.ts, schedule.ts
├─ pages/          one folder/file per module
└─ styles/         tokens.css (brand colours), base, layout, components, pages, print (A5 templates)
```

## Before freezing

- Brand hex values were sampled from the client palette image (`#1A58AB`, `#009EE5`, `#FD6801`, `#1F2B3B`) — confirm with the client (spec §Brand).
- Institute name, address and phone come from Settings (seeded from the receipt template).
