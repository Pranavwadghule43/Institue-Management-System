# Update Computers IMS — UI handoff

Two packages in this folder:

| File | For | What's inside |
|---|---|---|
| `IMS-UI-source-code.zip` | Developers | React 18 + TypeScript + Vite source (no `node_modules`) |
| `IMS-UI-figma-import.zip` | Designers | 33 screens as editable SVG + PNG reference + design tokens |
| `IMS-UI-demo.html` | Anyone | The whole UI in one file — double-click to open in Chrome/Edge |

Demo sign-in: `admin` (Admin view) or any other username (Staff view), any password of 4+ characters.
The **Viewing as Admin / Staff** switch in the top bar flips between the two roles.

---

## Code — run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build → dist/
npm run build:demo   # single-file demo → dist-demo/index.html
```

Where to change the look:

| What | File |
|---|---|
| Colours, fonts, radii, spacing (design tokens) | `src/styles/tokens.css` |
| Buttons, inputs, tables, badges, dialogs | `src/styles/components.css` |
| App shell (sidebar, top bar, status bar) | `src/styles/layout.css`, `src/app/AppShell.tsx` |
| Page-specific styles (dashboard, bill desk, receipt…) | `src/styles/pages.css` |
| Navigation / menu structure | `src/app/nav.ts` |
| Admin dashboard / Staff dashboard | `src/pages/Dashboard.tsx`, `src/pages/StaffDashboard.tsx` |
| Bill desk (items ⟷ live bill) | `src/pages/services/BillDesk.tsx` |
| WhatsApp send dialog (receipts & bills) | `src/components/WhatsAppSend.tsx`, `src/lib/whatsapp.ts` |
| Receipt & bill header details (address, phone) | `src/lib/institute.ts` — **placeholders, replace** |
| Sample data (replace with API) | `src/data/mock.ts`, `src/data/store.ts` |

Phase 1 is **laptop/PC only** (min width 1280px). Tablet/mobile rules are parked in
`src/styles/responsive.css` (not imported) — see the note at the top of that file to switch them on later.

---

## Figma — import the screens

A native `.fig` file can't be generated outside Figma, so the screens are delivered as **SVG**, which Figma
imports as real layers: text stays editable text, boxes/lines/icons stay vectors.

1. **Install the fonts first** (free, Google Fonts): *IBM Plex Sans* (400, 500, 600, 700) and *IBM Plex Mono* (400, 500).
   Without them Figma substitutes another font and spacing shifts.
2. Create a new Figma design file.
3. Drag all files from `screens/` onto the canvas (or *File → Import*). Each screen lands as one group, 1440 px wide.
4. Select a screen group → *Frame selection* (Ctrl/⌘ + Alt + G) to turn it into a frame.
5. Optional — colours as styles/variables: install the **Tokens Studio for Figma** plugin and load
   `design-tokens.json` (Light and Dark themes are included).
6. `png/` has a pixel-exact picture of every screen to compare against.

Good to know:

- Layers are positioned absolutely (no auto-layout) and repeated items aren't linked components yet —
  the expected next step is to rebuild buttons, inputs, badges and table rows as Figma components.
- `09-fee-receipt-whatsapp.svg` and `21-bill-whatsapp.svg` contain just the WhatsApp dialog; the PNGs show it over the page.
- Prefer a fully layered import with auto-layout? Run the demo (`npm run dev`) and use the
  **html.to.design** Figma plugin on `http://localhost:5173` — it converts the live page.

### Screen list

| # | Screen | # | Screen |
|---|---|---|---|
| 01 | Staff sign-in | 18 | Service bills |
| 02 | Dashboard — Admin | 19 | Bill desk — new bill |
| 03 | Dashboard — Staff ("My counter") | 20 | Bill desk — paid bill |
| 04 | Students list | 21 | Send bill on WhatsApp |
| 05 | New admission | 22 | Service master |
| 06 | Student profile | 23 | Expenses |
| 07 | Fee collection | 24 | Daily cash |
| 08 | Fee receipt | 25 | Profit & loss |
| 09 | Send receipt on WhatsApp | 26 | Reports centre |
| 10 | Payment history | 27 | Report viewer |
| 11 | Fee reminders | 28 | Staff |
| 12 | Courses | 29 | Permissions |
| 13 | Batches | 30 | Audit & deleted history |
| 14 | Service jobs board | 31 | Backup & restore |
| 15 | Service job detail | 32 | Settings |
| 16 | Customers | 33 | Dashboard — dark mode |
| 17 | Customer profile | | |

### Brand tokens (from the client palette — confirm hex values before freezing)

| Token | Hex | Use |
|---|---|---|
| Dark Blue | `#1A58AB` | Primary actions, navigation |
| Light Blue | `#009EE5` | Information, secondary series |
| Orange | `#FD6801` | Accent / call-to-action only |
| White | `#FFFFFF` | Surfaces |
| Dark Text | `#1F2B3B` | Primary text |
