import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, BarChart3, Briefcase, IndianRupee, MessageCircle, ShieldCheck, Table2 } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { BarChart, Legend, type Series } from '../components/BarChart';
import { Panel, Person, Segmented } from '../components/ui';
import { db, balanceFor, feeState, kpis, nextDue, overdueDays, series, useStore } from '../data/store';
import type { JobStatus } from '../data/types';
import { ago, count, dateShort, longDate, money, time } from '../lib/format';
import { waLink, feeReminderText } from '../lib/whatsapp';
import StaffDashboard from './StaffDashboard';
import { Shortcuts } from '../components/Shortcuts';

const SERIES: Series[] = [
  { key: 'fees', name: 'Student fees', color: 'var(--series-1)' },
  { key: 'services', name: 'Service income', color: 'var(--series-2)' },
];

const STATUS_COLORS: Record<JobStatus, string> = {
  Pending: 'var(--warning-500)',
  'In Process': 'var(--info-500)',
  'On Hold': 'var(--hold-700)',
  Completed: 'var(--success-500)',
  Cancelled: 'var(--danger-500)',
};

function Delta({ now, prev }: { now: number; prev: number }) {
  if (!prev) return <span className="muted">no data yesterday</span>;
  const d = Math.round(((now - prev) / prev) * 100);
  const up = d >= 0;
  return (
    <>
      <span className={`delta ${up ? 'up' : 'down'}`}>
        {up ? <ArrowUpRight /> : <ArrowDownRight />}
        {d > 200 ? `${(now / prev).toFixed(1)}×` : `${Math.abs(d)}%`}
      </span>
      vs yesterday
    </>
  );
}

export default function Dashboard() {
  const { role } = useApp();
  return role === 'Staff' ? <StaffDashboard /> : <AdminDashboard />;
}

function AdminDashboard() {
  useStore();
  const { can, toast } = useApp();
  const nav = useNavigate();
  const [range, setRange] = useState<'7' | '14' | '30'>('14');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const k = kpis();
  const s = useMemo(() => series(Number(range)), [range, k.today.fees, k.today.services]);
  const lastReceipt = [...db.payments].reverse().find((p) => p.status === 'Valid' && p.at >= db.TODAY);

  const rangeTotals = s.reduce((a, d) => ({ fees: a.fees + d.fees, services: a.services + d.services, expenses: a.expenses + d.expenses }), { fees: 0, services: 0, expenses: 0 });

  const followUps = db.students
    .filter((x) => x.status === 'Active' && ['Overdue', 'Due Today'].includes(feeState(x)))
    .sort((a, b) => overdueDays(b) - overdueDays(a))
    .slice(0, 8);


  const totalJobs = Object.values(k.jobs).reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="dayhead">
        <div>
          <div className="dayhead__date">{longDate(new Date())}</div>
          <h1>Dashboard</h1>
          <p className="dayhead__facts">
            {lastReceipt ? (
              <>
                Last receipt <span className="mono">{lastReceipt.receiptNo}</span> at {time(lastReceipt.at)} by {db.staffById(lastReceipt.by).name.split(' ')[0]}
              </>
            ) : (
              'No receipts yet today'
            )}
            <span className="sep">·</span>
            <Link to="/fees/reminders?tab=Overdue">{k.overdueCount} overdue fee follow-ups</Link>
            <span className="sep">·</span>
            <Link to="/services/jobs">{k.jobs.Pending + k.jobs['In Process']} open service jobs</Link>
          </p>
        </div>
        <Link className="btn btn-secondary" to="/finance/daily-cash">
          Today’s day book
        </Link>
      </div>

      <Shortcuts />

      {/* Required KPIs (M02 / FR-034, FR-035) */}
      <section className="ledger" aria-label="Today at a glance">
        <div className="ledger__group">
          <h2 className="ledger__title">Students</h2>
          <div className="ledger__cells">
            <Link to="/students" className="cell">
              <span>Total students</span>
              <strong>{count(k.totalStudents)}</strong>
              <small>{k.monthAdmissions} admitted this month</small>
            </Link>
            <Link to="/students?status=Active" className="cell">
              <span>Active</span>
              <strong>{count(k.activeStudents)}</strong>
              <small>{Math.round((k.activeStudents / k.totalStudents) * 100)}% of enrolments</small>
            </Link>
            <Link to="/students" className="cell">
              <span>Admissions today</span>
              <strong>{k.todayAdmissions}</strong>
              <small>&nbsp;</small>
            </Link>
            <Link to="/fees/reminders" className="cell">
              <span>Pending fees</span>
              <strong>{money(k.pendingFees)}</strong>
              <small className="warn">{k.overdueCount} students overdue</small>
            </Link>
          </div>
        </div>
        <div className="ledger__group">
          <h2 className="ledger__title">Money today</h2>
          <div className="ledger__cells">
            <Link to="/fees/payments" className="cell">
              <span>Fee collection</span>
              <strong>{money(k.today.fees)}</strong>
              <small>
                <Delta now={k.today.fees} prev={k.yesterday.fees} />
              </small>
            </Link>
            <Link to="/services/bills" className="cell">
              <span>Service income</span>
              <strong>{money(k.today.services)}</strong>
              <small>
                <Delta now={k.today.services} prev={k.yesterday.services} />
              </small>
            </Link>
            <Link to="/expenses" className="cell">
              <span>Expenses</span>
              <strong>{money(k.today.expenses)}</strong>
              <small>{db.expenses.filter((e) => e.date >= db.TODAY).length} entries</small>
            </Link>
            <Link to="/finance/daily-cash" className="cell cell--net">
              <span>Net income</span>
              <strong>{money(k.today.net)}</strong>
              <small className="mono">
                {k.today.fees.toLocaleString('en-IN')} + {k.today.services.toLocaleString('en-IN')} − {k.today.expenses.toLocaleString('en-IN')}
              </small>
            </Link>
          </div>
        </div>
      </section>

      <div className="dash-grid">
        <Panel
          title="Income trend"
          
          sub={`Student fees and service income — last ${range} days`}
          actions={
            <>
              <Segmented
                value={range}
                onChange={setRange}
                options={[
                  { value: '7', label: '7D' },
                  { value: '14', label: '14D' },
                  { value: '30', label: '30D' },
                ]}
              />
              <button className="icon-btn sm" aria-label={view === 'chart' ? 'Show as table' : 'Show as chart'} data-tip={view === 'chart' ? 'Table view' : 'Chart view'} onClick={() => setView(view === 'chart' ? 'table' : 'chart')}>
                {view === 'chart' ? <Table2 /> : <BarChart3 />}
              </button>
            </>
          }
        >
          <div className="row-between" style={{ alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 6 }}>
            <div className="chart-summary" style={{ marginBottom: 8 }}>
              <div>
                <span>Student fees</span>
                <strong className="num">{money(rangeTotals.fees)}</strong>
              </div>
              <div>
                <span>Service income</span>
                <strong className="num">{money(rangeTotals.services)}</strong>
              </div>
              <div>
                <span>Expenses</span>
                <strong className="num">{money(rangeTotals.expenses)}</strong>
              </div>
            </div>
            <Legend series={SERIES} />
          </div>
          {view === 'chart' ? (
            <BarChart
              ariaLabel={`Daily income for the last ${range} days`}
              data={s.map((d) => ({ label: range === '7' ? d.date.toLocaleDateString('en-IN', { weekday: 'short' }) : dateShort(d.date).replace(/\s\w+$/, (m) => m), sub: longDate(d.date), values: { fees: d.fees, services: d.services } }))}
              series={SERIES}
            />
          ) : (
            <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="ta-r">Student fees</th>
                    <th className="ta-r">Service income</th>
                    <th className="ta-r">Expenses</th>
                    <th className="ta-r">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {[...s].reverse().map((d) => (
                    <tr key={d.date.toISOString()}>
                      <td>{dateShort(d.date)}</td>
                      <td className="ta-r num">{money(d.fees)}</td>
                      <td className="ta-r num">{money(d.services)}</td>
                      <td className="ta-r num">{money(d.expenses)}</td>
                      <td className="ta-r num" style={{ fontWeight: 700 }}>
                        {money(d.fees + d.services - d.expenses)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Service desk" sub={`${totalJobs} jobs in the last 30 days`} actions={<Link to="/services/jobs" className="btn btn-ghost btn-sm">Open board</Link>}>
          <div className="statusbar" aria-hidden>
            {(Object.keys(k.jobs) as JobStatus[]).map((st) => (
              <span key={st} style={{ flex: k.jobs[st], background: STATUS_COLORS[st] }} />
            ))}
          </div>
          <div className="status-list">
            {(Object.keys(k.jobs) as JobStatus[]).map((st) => (
              <Link key={st} to={`/services/jobs?status=${encodeURIComponent(st)}`} className="status-row">
                <span className="sq" style={{ background: STATUS_COLORS[st] }} />
                {st}
                <strong>{k.jobs[st]}</strong>
              </Link>
            ))}
          </div>
          <div className="mini-stats">
            <div>
              <span>Completed today</span>
              <strong>{k.completedToday}</strong>
            </div>
            <div>
              <span>Unpaid bills</span>
              <strong>{k.unpaidBills}</strong>
            </div>
            <div>
              <span>Pending amount</span>
              <strong>{money(k.pendingServiceAmount)}</strong>
            </div>
          </div>
        </Panel>
      </div>

      <div className="dash-grid even">
        <Panel
          flush
          title="Fee follow-ups"
          
          sub="Overdue and due today — remind on WhatsApp or collect now"
          actions={
            <Link to="/fees/reminders" className="btn btn-ghost btn-sm">
              View all
            </Link>
          }
        >
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {followUps.map((st) => {
                  const n = nextDue(st)!;
                  const od = overdueDays(st);
                  return (
                    <tr key={st.id} className="is-clickable" onClick={() => nav(`/students/${st.id}`)}>
                      <td>
                        <Person name={st.name} sub={`${st.id} · ${db.courseById(st.courseId).code}`} />
                      </td>
                      <td>
                        <div className="num" style={{ fontWeight: 700 }}>
                          {money(n.remaining)}
                        </div>
                        <div style={{ fontSize: 12, color: od ? 'var(--danger-700)' : 'var(--accent-700)', fontWeight: 600 }}>{od ? `${od} days overdue` : 'Due today'}</div>
                      </td>
                      <td className="ta-r">
                        <div className="actions">
                          <a
                            className="icon-btn sm"
                            style={{ color: '#1fa855' }}
                            href={waLink(st.phone, feeReminderText(st.name, n.remaining, n.due, balanceFor(st)))}
                            target="_blank"
                            rel="noreferrer"
                            data-tip="WhatsApp reminder"
                            aria-label={`Send WhatsApp reminder to ${st.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toast('success', 'WhatsApp opened', `Reminder prepared for ${st.name}`);
                            }}
                          >
                            <MessageCircle />
                          </a>
                          {can('fees.collect') && (
                            <Link className="btn btn-secondary btn-sm" to={`/fees/collect?student=${st.id}`} onClick={(e) => e.stopPropagation()}>
                              Collect
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="stack">
          <Panel flush title="Recent activity" actions={can('audit.view') ? <Link to="/admin/audit" className="btn btn-ghost btn-sm">Audit log</Link> : undefined}>
            <div className="feed">
              {db.audit.slice(0, 5).map((a) => (
                <div className="feed-item" key={a.id}>
                  <span className={`feed-item__ico ${a.action.startsWith('PAYMENT') || a.action === 'BILL_PAID' ? 'money' : a.action.startsWith('JOB') ? 'job' : a.action.includes('FAILED') ? 'alert' : 'admin'}`}>
                    {a.action.startsWith('PAYMENT') ? <IndianRupee /> : a.action.startsWith('JOB') ? <Briefcase /> : <ShieldCheck />}
                  </span>
                  <div>
                    <p>{a.summary}</p>
                    <small>
                      {db.staffById(a.actor)?.name ?? 'System'} · {ago(a.at)}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
