import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BadgeIndianRupee, Ban, BookOpen, Briefcase, CalendarDays, ChevronRight, ClipboardCheck, ClipboardList, FileSpreadsheet, FileText, History, IndianRupee,
  Layers, LineChart, Printer, Receipt, Search, ShieldCheck, TrendingUp, UserCog, Users, Wallet, type LucideIcon,
} from 'lucide-react';
import { useApp } from '../app/AppContext';
import { Empty, PageHeader, Pagination, Segmented, SkeletonRows, useLoading, usePaged } from '../components/ui';
import { balanceFor, customerJobs, db, feeState, monthTotals, netFee, paidFor, sum, useStore } from '../data/store';
import { date, dateTime, money } from '../lib/format';
import NotFound from './NotFound';
import { PAY_MODES } from '../lib/payModes';

type Cell = string | number;
interface Col { label: string; money?: boolean }
interface Report { slug: string; name: string; desc: string; group: string; icon: LucideIcon; isNew?: boolean; build: (from: Date) => { cols: Col[]; rows: Cell[][] } }

const inRange = (d: Date, from: Date) => d >= from;
const st = (id: string) => db.studentById(id);

export const REPORTS: Report[] = [
  { slug: 'student-list', name: 'Student list', desc: 'All students with course, batch and status', group: 'Students & fees', icon: Users, build: () => ({ cols: [{ label: 'Student ID' }, { label: 'Name' }, { label: 'Mobile' }, { label: 'Course' }, { label: 'Batch' }, { label: 'Status' }], rows: db.students.map((s) => [s.id, s.name, s.phone, db.courseById(s.courseId).code, db.batchById(s.batchId).name, s.status]) }) },
  { slug: 'course-wise', name: 'Course-wise students', desc: 'Enrolment and fee totals per course', group: 'Students & fees', icon: BookOpen, build: () => ({ cols: [{ label: 'Course' }, { label: 'Active' }, { label: 'Total' }, { label: 'Net fees', money: true }, { label: 'Collected', money: true }], rows: db.courses.map((c) => { const ss = db.students.filter((s) => s.courseId === c.id); return [c.name, ss.filter((s) => s.status === 'Active').length, ss.length, sum(ss, netFee), sum(ss, paidFor)]; }) }) },
  { slug: 'batch-wise', name: 'Batch-wise students', desc: 'Seats filled per batch with timing', group: 'Students & fees', icon: Layers, build: () => ({ cols: [{ label: 'Batch' }, { label: 'Timing' }, { label: 'Faculty' }, { label: 'Students' }, { label: 'Capacity' }], rows: db.batches.map((b) => [b.name, b.timing, b.teacher, db.students.filter((s) => s.batchId === b.id && s.status === 'Active').length, b.capacity]) }) },
  { slug: 'fee-collection', name: 'Fee collection', desc: 'Payments received in the period', group: 'Students & fees', icon: IndianRupee, build: (f) => ({ cols: [{ label: 'Receipt' }, { label: 'Date' }, { label: 'Student' }, { label: 'Mode' }, { label: 'Amount', money: true }], rows: db.payments.filter((p) => p.status === 'Valid' && inRange(p.at, f)).reverse().map((p) => [p.receiptNo, dateTime(p.at), st(p.studentId).name, p.mode, p.amount]) }) },
  { slug: 'pending-fee', name: 'Pending fee', desc: 'Students with outstanding balance', group: 'Students & fees', icon: BadgeIndianRupee, build: () => ({ cols: [{ label: 'Student' }, { label: 'Mobile' }, { label: 'Course' }, { label: 'Fee state' }, { label: 'Net fee', money: true }, { label: 'Balance', money: true }], rows: db.students.filter((s) => s.status === 'Active' && balanceFor(s) > 0).map((s) => [s.name, s.phone, db.courseById(s.courseId).code, feeState(s), netFee(s), balanceFor(s)]) }) },
  { slug: 'payment-history', name: 'Payment history', desc: 'Every payment including reversals', group: 'Students & fees', icon: History, build: (f) => ({ cols: [{ label: 'Receipt' }, { label: 'Date' }, { label: 'Student' }, { label: 'Status' }, { label: 'Amount', money: true }], rows: db.payments.filter((p) => inRange(p.at, f)).reverse().map((p) => [p.receiptNo, dateTime(p.at), st(p.studentId).name, p.status, p.amount]) }) },
  { slug: 'daily-collection', name: 'Daily collection', desc: 'Day-by-day student fee totals', group: 'Finance', icon: CalendarDays, build: (f) => { const days: Cell[][] = []; for (let d = new Date(db.TODAY); d >= f; d.setDate(d.getDate() - 1)) { const ps = db.payments.filter((p) => p.status === 'Valid' && p.at.toDateString() === d.toDateString()); days.push([date(d), ps.length, sum(ps, (p) => p.amount)]); } return { cols: [{ label: 'Date' }, { label: 'Receipts' }, { label: 'Collected', money: true }], rows: days }; } },
  { slug: 'expense', name: 'Expense report', desc: 'Expenses with category and mode', group: 'Finance', icon: Receipt, build: (f) => ({ cols: [{ label: 'Date' }, { label: 'Category' }, { label: 'Remark' }, { label: 'Mode' }, { label: 'Amount', money: true }], rows: db.expenses.filter((e) => inRange(e.date, f)).map((e) => [date(e.date), e.category, e.remark, e.mode, e.amount]) }) },
  { slug: 'service-income', name: 'Service income', desc: 'Paid service bills in the period', group: 'Finance', icon: Briefcase, build: (f) => ({ cols: [{ label: 'Bill' }, { label: 'Paid on' }, { label: 'Customer' }, { label: 'Mode' }, { label: 'Amount', money: true }], rows: db.bills.filter((b) => b.status === 'Paid' && b.paidAt && inRange(b.paidAt, f)).map((b) => [b.id, dateTime(b.paidAt!), db.customerById(b.customerId).name, b.mode!, db.billTotal(b)]) }) },
  { slug: 'daily-cash', name: 'Daily cash', desc: 'Fees + services − expenses per day', group: 'Finance', icon: Wallet, build: (f) => { const rows: Cell[][] = []; for (let d = new Date(db.TODAY); d >= f; d.setDate(d.getDate() - 1)) { const same = (x: Date) => x.toDateString() === d.toDateString(); const a = sum(db.payments.filter((p) => p.status === 'Valid' && same(p.at)), (p) => p.amount); const b = sum(db.bills.filter((x) => x.status === 'Paid' && x.paidAt && same(x.paidAt)), db.billTotal); const c = sum(db.expenses.filter((e) => same(e.date)), (e) => e.amount); rows.push([date(d), a, b, c, a + b - c]); } return { cols: [{ label: 'Date' }, { label: 'Fees', money: true }, { label: 'Services', money: true }, { label: 'Expenses', money: true }, { label: 'Net', money: true }], rows }; } },
  { slug: 'monthly-income', name: 'Monthly income', desc: 'Income by month', group: 'Finance', icon: TrendingUp, build: () => ({ cols: [{ label: 'Month' }, { label: 'Fees', money: true }, { label: 'Services', money: true }, { label: 'Total', money: true }], rows: [...db.monthHistory, { label: 'This month', ...monthTotals(0) }].reverse().map((m) => [m.label, m.fees, m.services, m.fees + m.services]) }) },
  { slug: 'pnl', name: 'Profit & loss', desc: 'Income, expenses and net by month', group: 'Finance', icon: LineChart, build: () => ({ cols: [{ label: 'Month' }, { label: 'Income', money: true }, { label: 'Expenses', money: true }, { label: 'Net', money: true }], rows: [...db.monthHistory, { label: 'This month', ...monthTotals(0) }].reverse().map((m) => [m.label, m.fees + m.services, m.expenses, m.fees + m.services - m.expenses]) }) },
  { slug: 'staff-collection', name: 'Staff-wise collection', desc: 'Fees collected by each staff member', group: 'Staff & audit', icon: UserCog, build: (f) => ({ cols: [{ label: 'Staff' }, { label: 'Receipts' }, { label: 'Collected', money: true }], rows: db.staff.map((s) => { const ps = db.payments.filter((p) => p.by === s.id && p.status === 'Valid' && inRange(p.at, f)); return [s.name, ps.length, sum(ps, (p) => p.amount)]; }) }) },
  { slug: 'staff-activity', name: 'Staff activity', desc: 'Actions performed by staff', group: 'Staff & audit', icon: ClipboardList, build: (f) => ({ cols: [{ label: 'When' }, { label: 'Staff' }, { label: 'Action' }, { label: 'Details' }], rows: db.audit.filter((a) => inRange(a.at, f)).map((a) => [dateTime(a.at), db.staffById(a.actor)?.name ?? 'System', a.action, a.summary]) }) },
  { slug: 'deleted-records', name: 'Deleted records', desc: 'Deleted, reversed and cancelled history', group: 'Staff & audit', icon: ShieldCheck, build: () => ({ cols: [{ label: 'When' }, { label: 'Staff' }, { label: 'Action' }, { label: 'Record' }], rows: db.audit.filter((a) => /DELETED|REVERSED|CANCELLED/.test(a.action)).map((a) => [dateTime(a.at), db.staffById(a.actor)?.name ?? '', a.action, a.entityId]) }) },
  { slug: 'daily-service', name: 'Daily service', desc: 'Jobs received and completed per day', group: 'Services', icon: CalendarDays, isNew: true, build: (f) => { const rows: Cell[][] = []; for (let d = new Date(db.TODAY); d >= f; d.setDate(d.getDate() - 1)) { const same = (x: Date) => x.toDateString() === d.toDateString(); rows.push([date(d), db.jobs.filter((j) => same(j.serviceDate)).length, db.jobs.filter((j) => j.history.some((h) => h.status === 'Completed' && same(h.at))).length, sum(db.bills.filter((b) => b.status === 'Paid' && b.paidAt && same(b.paidAt)), db.billTotal)]); } return { cols: [{ label: 'Date' }, { label: 'Received' }, { label: 'Completed' }, { label: 'Revenue', money: true }], rows }; } },
  { slug: 'monthly-service', name: 'Monthly service', desc: 'Service revenue by month', group: 'Services', icon: TrendingUp, isNew: true, build: () => ({ cols: [{ label: 'Month' }, { label: 'Revenue', money: true }], rows: [...db.monthHistory, { label: 'This month', ...monthTotals(0) }].reverse().map((m) => [m.label, m.services]) }) },
  { slug: 'service-revenue', name: 'Service-wise revenue', desc: 'Revenue and count per service', group: 'Services', icon: BadgeIndianRupee, isNew: true, build: (f) => ({ cols: [{ label: 'Service' }, { label: 'Times billed' }, { label: 'Revenue', money: true }], rows: db.services.map((s) => { const items = db.bills.filter((b) => b.status === 'Paid' && inRange(b.createdAt, f)).flatMap((b) => b.items.filter((i) => i.serviceId === s.id)); return [s.name, items.length, sum(items, (i) => i.qty * i.rate)] as Cell[]; }).filter((r) => (r[1] as number) > 0).sort((a, b) => (b[2] as number) - (a[2] as number)) }) },
  { slug: 'customer-history', name: 'Customer-wise service history', desc: 'Jobs and billing per customer', group: 'Services', icon: Users, isNew: true, build: () => ({ cols: [{ label: 'Customer' }, { label: 'Mobile' }, { label: 'Jobs' }, { label: 'Paid', money: true }], rows: db.customers.map((c) => [c.name, c.mobile, customerJobs(c).length, sum(db.bills.filter((b) => b.customerId === c.id && b.status === 'Paid'), db.billTotal)]) }) },
  { slug: 'pending-jobs', name: 'Pending service jobs', desc: 'Open jobs with deadlines', group: 'Services', icon: ClipboardList, isNew: true, build: () => ({ cols: [{ label: 'Job' }, { label: 'Customer' }, { label: 'Service' }, { label: 'Status' }, { label: 'Last date' }], rows: db.jobs.filter((j) => ['Pending', 'In Process', 'On Hold'].includes(j.status)).map((j) => [j.id, db.customerById(j.customerId).name, db.serviceById(j.serviceIds[0]).name, j.status, date(j.lastDate)]) }) },
  { slug: 'completed-jobs', name: 'Completed service jobs', desc: 'Jobs completed in the period', group: 'Services', icon: ClipboardCheck, isNew: true, build: (f) => ({ cols: [{ label: 'Job' }, { label: 'Customer' }, { label: 'Service' }, { label: 'Completed' }], rows: db.jobs.filter((j) => j.status === 'Completed').map((j) => [j.id, db.customerById(j.customerId).name, db.serviceById(j.serviceIds[0]).name, j.history[j.history.length - 1].at] as const).filter((r) => r[3] >= f).map((r) => [r[0], r[1], r[2], dateTime(r[3])]) }) },
  { slug: 'staff-service', name: 'Staff-wise service', desc: 'Jobs handled by each staff member', group: 'Services', icon: UserCog, isNew: true, build: () => ({ cols: [{ label: 'Staff' }, { label: 'Open' }, { label: 'Completed' }, { label: 'Total' }], rows: db.staff.map((s) => { const js = db.jobs.filter((j) => j.assignees.includes(s.id)); return [s.name, js.filter((j) => ['Pending', 'In Process', 'On Hold'].includes(j.status)).length, js.filter((j) => j.status === 'Completed').length, js.length]; }) }) },
  { slug: 'service-payment', name: 'Service payment', desc: 'Bill payments by mode', group: 'Services', icon: Wallet, isNew: true, build: (f) => ({ cols: [{ label: 'Mode' }, { label: 'Bills' }, { label: 'Amount', money: true }], rows: PAY_MODES.map((m) => { const bs = db.bills.filter((b) => b.status === 'Paid' && b.mode === m && b.paidAt && inRange(b.paidAt, f)); return [m, bs.length, sum(bs, db.billTotal)]; }) }) },
  { slug: 'cancelled-bills', name: 'Cancelled service bills', desc: 'Cancelled bills with reasons', group: 'Services', icon: Ban, isNew: true, build: () => ({ cols: [{ label: 'Bill' }, { label: 'Customer' }, { label: 'Reason' }, { label: 'Amount', money: true }], rows: db.bills.filter((b) => b.status === 'Cancelled').map((b) => [b.id, db.customerById(b.customerId).name, b.cancelReason ?? '', db.billTotal(b)]) }) },
  { slug: 'service-profit', name: 'Service profit', desc: 'Revenue less service cost (pending C-46)', group: 'Services', icon: LineChart, isNew: true, build: () => ({ cols: [{ label: 'Month' }, { label: 'Revenue', money: true }, { label: 'Cost' }, { label: 'Profit' }], rows: [...db.monthHistory, { label: 'This month', ...monthTotals(0) }].reverse().map((m) => [m.label, m.services, 'Pending', 'Pending']) }) },
];

const GROUPS = ['Students & fees', 'Finance', 'Staff & audit', 'Services'];

export function ReportsCenter() {
  const [q, setQ] = useState('');
  const list = REPORTS.filter((r) => !q || (r.name + r.desc).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader
        title="Reports"
        sub={`${REPORTS.length} reports — view on screen, print, save as PDF or export to Excel.`}
        crumbs={[['Reports']]}
        actions={
          <div className="input-group" style={{ width: 280 }}>
            <Search />
            <input className="input" placeholder="Find a report…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a report" />
          </div>
        }
      />
      {list.length === 0 ? (
        <section className="panel">
          <Empty icon={<FileText />} title="No report matches" body="Try “fee”, “service” or “expense”." />
        </section>
      ) : (
        <div className="report-groups">
          {GROUPS.map((g) => {
            const items = list.filter((r) => r.group === g);
            if (!items.length) return null;
            return (
              <section className="panel" key={g}>
                <div className="panel__head">
                  <h2>{g}</h2>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {items.length} reports
                  </span>
                </div>
                {items.map((r) => (
                  <Link key={r.slug} to={`/reports/${r.slug}`} className="report-link">
                    <span className="ri">
                      <r.icon />
                    </span>
                    <span>
                      <strong>
                        {r.name}
                        {r.isNew && <span className="new-tag">SERVICE</span>}
                      </strong>
                      <small>{r.desc}</small>
                    </span>
                    <ChevronRight className="go" />
                  </Link>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

export function ReportViewer() {
  useStore();
  const { slug } = useParams();
  const { toast } = useApp();
  const [range, setRange] = useState<'7' | '30' | '90' | '365'>('30');
  const loading = useLoading(500, [range, slug]);
  const r = REPORTS.find((x) => x.slug === slug);
  const from = db.day(-Number(range) + 1, 0, 0);
  const data = useMemo(() => (r ? r.build(new Date(from)) : { cols: [], rows: [] }), [r, range]);
  const pg = usePaged(data.rows, 15);
  if (!r) return <NotFound what="report" />;
  const moneyIdx = data.cols.map((c, i) => (c.money ? i : -1)).filter((i) => i >= 0);

  return (
    <>
      <PageHeader
        title={r.name}
        sub={r.desc}
        crumbs={[['Reports', '/reports'], [r.name]]}
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => window.print()}>
              <Printer /> Print
            </button>
            <button className="btn btn-secondary" onClick={() => toast('success', 'PDF generated', `${r.name}.pdf`)}>
              <FileText /> PDF
            </button>
            <button className="btn btn-primary" onClick={() => toast('success', 'Excel export ready', `${r.name}.xlsx · ${data.rows.length} rows`)}>
              <FileSpreadsheet /> Excel
            </button>
          </>
        }
      />
      <section className="panel">
        <div className="table-toolbar">
          <span className="field__label">Period</span>
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
              { value: '365', label: '1 year' },
            ]}
          />
          <span className="muted" style={{ fontSize: 12.5 }}>
            {date(from)} – {date(db.TODAY)}
          </span>
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
            {data.rows.length} rows
          </span>
        </div>
        {loading ? (
          <SkeletonRows rows={10} cols={Math.max(3, data.cols.length)} />
        ) : data.rows.length === 0 ? (
          <Empty icon={<FileText />} title="No data for this period" body="Choose a longer period to see results." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {data.cols.map((c) => (
                      <th key={c.label} className={c.money || typeof data.rows[0]?.[data.cols.indexOf(c)] === 'number' ? 'ta-r' : ''}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pg.slice.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, k) => (
                        <td key={k} className={typeof cell === 'number' ? 'ta-r num' : ''} style={data.cols[k].money ? { fontWeight: 600 } : undefined}>
                          {data.cols[k].money && typeof cell === 'number' ? money(cell) : cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {moneyIdx.length > 0 && (
                  <tfoot>
                    <tr>
                      {data.cols.map((c, k) => (
                        <td key={k} className={c.money ? 'ta-r num' : ''}>
                          {k === 0 ? 'Total' : c.money ? money(sum(data.rows, (row) => Number(row[k]) || 0)) : ''}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <Pagination {...pg} noun="rows" />
          </>
        )}
      </section>
    </>
  );
}
