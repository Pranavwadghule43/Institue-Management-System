# Updaate Computers — Institute Management System (UI)

React 18 + TypeScript + Vite front-end for the IMS described in `07_UI_UX_DESIGN_SPECIFICATION.md`.
Phase 1 (UI) — screens run on in-memory sample data. New records reset on reload. This checkout does not include the FastAPI backend, MySQL database or migrations. See [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) for the Phase 1 review changes and remaining backend work.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build → dist/
npm run build:demo   # ONE self-contained file → dist-demo/index.html (double-click / email to client)
```

Sign in with `admin` (Admin view) or any other username (Staff view), any password of 4+ characters.
Use the **Viewing as Admin / Staff** switch in the top bar to show the client how permissions change the UI.

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

- **Add:** type in the search box and press Enter, or click a counter-item shortcut (B/W print, lamination…). Adding the same item again raises its quantity.
- **Update:** − / + quantity stepper, or the pencil to change the service, quantity and (Admin only) rate. Overridden rates are flagged and audited.
- **Delete:** bin icon, with an Undo bar for 7 seconds.
- Fixed-amount discount, full payment only, paid bills locked; Admin can unlock a paid bill with a reason (WF-09) or cancel it with typed confirmation (WF-10).

## Aligned with the specification

- Student status Active / Completed / Left (FR-006); Aadhaar searchable (FR-036).
- Payment modes Cash, GPay, PhonePe, other UPI, Card, Bank transfer (BR-005).
- Service job status changes follow WF-07 (Completed and Cancelled are final).
- P&L for today, week, month, financial year and custom range (FR-032).
- Sign-in throttled after 5 failed attempts (FR-003); generic error text (M01).

## Handoff

`handoff/` holds the packages for colleagues — source code zip, Figma import zip (33 editable SVG screens + PNGs +
design tokens) and the single-file demo. See `handoff/HANDOFF.md`.

## Structure

```
src/
├─ app/            AppContext (role, permissions, theme, toasts), AppShell (sidebar, topbar, command palette), nav
├─ components/     ui.tsx (Badge/Modal/Drawer/Table helpers/Field/MoneyInput…), BarChart.tsx, PayModePicker.tsx
├─ data/           types.ts, mock.ts (sample data), store.ts (selectors + mutations — swap for API calls)
├─ lib/            format.ts (₹ Indian grouping, dates, amount in words), whatsapp.ts (wa.me links), institute.ts, payModes.ts
├─ pages/          one folder/file per module
└─ styles/         tokens.css (brand colours), base, layout, components, pages
```

## Before freezing

- Brand hex values were sampled from the client palette image (`#1A58AB`, `#009EE5`, `#FD6801`, `#1F2B3B`) — confirm with the client (spec §Brand).
- `src/lib/institute.ts` holds **placeholder** address / phone / email for receipts — replace with real details.
- `src/data/store.ts` is the seam for the FastAPI backend: replace selectors/mutations with TanStack Query hooks.
