import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, BarChart3, Briefcase, IndianRupee, MessageCircle, ShieldCheck, Table2 } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { BarChart, Legend, type Series } from '../components/BarChart';
import { LoadError, Panel, Person, Segmented, SkeletonRows } from '../components/ui';
import { useQuery } from '../api/client';
import type { AuditItem, DayTotals, Followup, JobStatus, SeriesRow } from '../api/types';
import { ago, count, dateShort, longDate, money, n, time, toDate } from '../lib/format';
import { feeReminderText, waLink } from '../lib/whatsapp';
import StaffDashboard from './StaffDashboard';

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

interface AdminDash {
  kpis: { total_students: number; active_students: number; admissions_today: number; pending_fees: string; fee_collection_today: string; service_income_today: string; expenses_today: string; net_income_today: string };
  admissions_this_month: number; overdue_students: number; last_receipt: { receipt_no: string; at: string; amount: string; by: { name: string } | null } | null;
  trend: SeriesRow[]; service_status_counts: Record<JobStatus, number>; service_desk: { completed_today: number; unpaid_bills: number; pending_amount: string };
  fee_followups: Followup[]; recent_activity: AuditItem[]; comparisons: { today: DayTotals; yesterday: DayTotals };
}

function Delta({ now, prev }: { now: number; prev: number }) {
  if (!prev) return <span className="muted">no data yesterday</span>;
  const d = Math.round(((now - prev) / prev) * 100);
  const up = d >= 0;
  return (
    <>
      <span className={`delta ${up ? 'up' : 'down'}`}>{up ? <ArrowUpRight /> : <ArrowDownRight />}{d > 200 ? `${(now / prev).toFixed(1)}×` : `${Math.abs(d)}%`}</span>
      vs yesterday
    </>
  );
}

export default function Dashboard() {
  const { role } = useApp();
  return role === 'Staff' ? <StaffDashboard /> : <AdminDashboard />;
}

function AdminDashboard() {
  const { can, toast } = useApp();
  const nav = useNavigate();
  const [range, setRange] = useState<'7' | '14' | '30'>('14');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const { data: k, error, loading, reload } = useQuery<AdminDash>('/dashboard/admin', { trend_days: range });
  if (error) return <LoadError error={error} retry={reload} />;
  if (loading || !k) return <SkeletonRows rows={8} cols={4} />;
  const today = k.comparisons.today;
  const yesterday = k.comparisons.yesterday;
  const sumOf = (key: 'fees' | 'services' | 'expenses') => k.trend.reduce((t, d) => t + n(d[key]), 0);
  const totalJobs = Object.values(k.service_status_counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="dayhead">
        <div>
          <div className="dayhead__date">{longDate(new Date())}</div>
          <h1>Dashboard</h1>
          <p className="dayhead__facts">
            {k.last_receipt ? <>Last receipt <span className="mono">{k.last_receipt.receipt_no}</span> at {time(k.last_receipt.at)}{k.last_receipt.by && ` by ${k.last_receipt.by.name.split(' ')[0]}`}</> : 'No receipts yet today'}
            <span className="sep">·</span>
            <Link to="/fees/reminders?tab=overdue">{k.overdue_students} overdue fee follow-ups</Link>
            <span className="sep">·</span>
            <Link to="/services/jobs">{k.service_status_counts.Pending + k.service_status_counts['In Process']} open service jobs</Link>
          </p>
        </div>
        <Link className="btn btn-secondary" to="/finance/daily-cash">Today’s day book</Link>
      </div>

      <section className="ledger" aria-label="Today at a glance">
        <div className="ledger__group">
          <h2 className="ledger__title">Students</h2>
          <div className="ledger__cells">
            <Link to="/students" className="cell"><span>Total students</span><strong>{count(k.kpis.total_students)}</strong><small>{k.admissions_this_month} admitted this month</small></Link>
            <Link to="/students?status=Active" className="cell"><span>Active</span><strong>{count(k.kpis.active_students)}</strong><small>{k.kpis.total_students ? Math.round((k.kpis.active_students / k.kpis.total_students) * 100) : 0}% of enrolments</small></Link>
            <Link to="/students" className="cell"><span>Admissions today</span><strong>{k.kpis.admissions_today}</strong><small>&nbsp;</small></Link>
            <Link to="/fees/reminders" className="cell"><span>Pending fees</span><strong>{money(k.kpis.pending_fees)}</strong><small className="warn">{k.overdue_students} students overdue</small></Link>
          </div>
        </div>
        <div className="ledger__group">
          <h2 className="ledger__title">Money today</h2>
          <div className="ledger__cells">
            <Link to="/fees/payments" className="cell"><span>Fee collection</span><strong>{money(today.fees)}</strong><small><Delta now={n(today.fees)} prev={n(yesterday.fees)} /></small></Link>
            <Link to="/services/bills" className="cell"><span>Service income</span><strong>{money(today.services)}</strong><small><Delta now={n(today.services)} prev={n(yesterday.services)} /></small></Link>
            <Link to="/expenses" className="cell"><span>Expenses</span><strong>{money(today.expenses)}</strong><small>&nbsp;</small></Link>
            <Link to="/finance/daily-cash" className="cell cell--net"><span>Net income</span><strong>{money(today.net)}</strong><small className="mono">{n(today.fees).toLocaleString('en-IN')} + {n(today.services).toLocaleString('en-IN')} − {n(today.expenses).toLocaleString('en-IN')}</small></Link>
          </div>
        </div>
      </section>

      <div className="dash-grid">
        <Panel
          title="Income trend"
          sub={`Student fees and service income — last ${range} days`}
          actions={
            <>
              <Segmented value={range} onChange={setRange} options={[{ value: '7', label: '7D' }, { value: '14', label: '14D' }, { value: '30', label: '30D' }]} />
              <button className="icon-btn sm" aria-label={view === 'chart' ? 'Show as table' : 'Show as chart'} data-tip={view === 'chart' ? 'Table view' : 'Chart view'} onClick={() => setView(view === 'chart' ? 'table' : 'chart')}>
                {view === 'chart' ? <Table2 /> : <BarChart3 />}
              </button>
            </>
          }
        >
          <div className="row-between" style={{ alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 6 }}>
            <div className="chart-summary" style={{ marginBottom: 8 }}>
              <div><span>Student fees</span><strong className="num">{money(sumOf('fees'))}</strong></div>
              <div><span>Service income</span><strong className="num">{money(sumOf('services'))}</strong></div>
              <div><span>Expenses</span><strong className="num">{money(sumOf('expenses'))}</strong></div>
            </div>
            <Legend series={SERIES} />
          </div>
          {view === 'chart' ? (
            <BarChart ariaLabel={`Daily income for the last ${range} days`} series={SERIES}
              data={k.trend.map((d) => ({ label: range === '7' ? toDate(d.key).toLocaleDateString('en-IN', { weekday: 'short' }) : dateShort(d.key), sub: longDate(d.key), values: { fees: n(d.fees), services: n(d.services) } }))} />
          ) : (
            <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
              <table className="table">
                <thead><tr><th>Date</th><th className="ta-r">Student fees</th><th className="ta-r">Service income</th><th className="ta-r">Expenses</th><th className="ta-r">Net</th></tr></thead>
                <tbody>
                  {[...k.trend].reverse().map((d) => (
                    <tr key={d.key}><td>{dateShort(d.key)}</td><td className="ta-r num">{money(d.fees)}</td><td className="ta-r num">{money(d.services)}</td><td className="ta-r num">{money(d.expenses)}</td><td className="ta-r num" style={{ fontWeight: 700 }}>{money(d.net)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Service desk" sub={`${totalJobs} jobs in total`} actions={<Link to="/services/jobs" className="btn btn-ghost btn-sm">Open board</Link>}>
          <div className="statusbar" aria-hidden>
            {(Object.keys(k.service_status_counts) as JobStatus[]).map((st) => <span key={st} style={{ flex: k.service_status_counts[st], background: STATUS_COLORS[st] }} />)}
          </div>
          <div className="status-list">
            {(Object.keys(k.service_status_counts) as JobStatus[]).map((st) => (
              <Link key={st} to={`/services/jobs?status=${encodeURIComponent(st)}`} className="status-row"><span className="sq" style={{ background: STATUS_COLORS[st] }} />{st}<strong>{k.service_status_counts[st]}</strong></Link>
            ))}
          </div>
          <div className="mini-stats">
            <div><span>Completed today</span><strong>{k.service_desk.completed_today}</strong></div>
            <div><span>Unpaid bills</span><strong>{k.service_desk.unpaid_bills}</strong></div>
            <div><span>Pending amount</span><strong>{money(k.service_desk.pending_amount)}</strong></div>
          </div>
        </Panel>
      </div>

      <div className="dash-grid even">
        <Panel flush title="Fee follow-ups" sub="Overdue and due today — remind on WhatsApp or collect now" actions={<Link to="/fees/reminders" className="btn btn-ghost btn-sm">View all</Link>}>
          {k.fee_followups.length === 0 ? <p className="muted" style={{ padding: 16, fontSize: 13 }}>No overdue or due-today fees.</p> : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {k.fee_followups.map((st) => (
                    <tr key={st.code} className="is-clickable" onClick={() => nav(`/students/${st.code}`)}>
                      <td><Person name={st.name} sub={`${st.code} · ${st.course_code}`} /></td>
                      <td>
                        <div className="num" style={{ fontWeight: 700 }}>{money(st.installment_due)}</div>
                        <div style={{ fontSize: 12, color: st.overdue_days ? 'var(--danger-700)' : 'var(--accent-700)', fontWeight: 600 }}>{st.overdue_days ? `${st.overdue_days} days overdue` : 'Due today'}</div>
                      </td>
                      <td className="ta-r">
                        <div className="actions">
                          <a className="icon-btn sm" style={{ color: '#1fa855' }} href={waLink(st.whatsapp_number || st.mobile, feeReminderText(st.name, st.installment_due, st.due_date, st.balance))} target="_blank" rel="noreferrer"
                            data-tip="WhatsApp reminder" aria-label={`Send WhatsApp reminder to ${st.name}`} onClick={(e) => { e.stopPropagation(); toast('success', 'WhatsApp opened', `Reminder prepared for ${st.name}`); }}>
                            <MessageCircle />
                          </a>
                          {can('fees.collect') && <Link className="btn btn-secondary btn-sm" to={`/fees/collect?student=${st.code}`} onClick={(e) => e.stopPropagation()}>Collect</Link>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="stack">
          <Panel flush title="Recent activity" actions={can('audit.view') ? <Link to="/admin/audit" className="btn btn-ghost btn-sm">Audit log</Link> : undefined}>
            <div className="feed">
              {k.recent_activity.length === 0 && <p className="muted" style={{ padding: 16, fontSize: 13 }}>No activity yet.</p>}
              {k.recent_activity.map((a, i) => (
                <div className="feed-item" key={i}>
                  <span className={`feed-item__ico ${a.action.startsWith('PAYMENT') || a.action === 'BILL_PAID' ? 'money' : a.action.startsWith('JOB') ? 'job' : a.action.includes('FAILED') || a.action.includes('LOCKED') ? 'alert' : 'admin'}`}>
                    {a.action.startsWith('PAYMENT') ? <IndianRupee /> : a.action.startsWith('JOB') ? <Briefcase /> : <ShieldCheck />}
                  </span>
                  <div><p>{a.summary}</p><small>{a.by?.name ?? 'System'} · {ago(a.at)}</small></div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
