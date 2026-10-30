import { Link, useNavigate } from 'react-router-dom';
import { Check, Lock, MessageCircle } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { JobStatusBadge, LoadError, Panel, Person, SkeletonRows } from '../components/ui';
import { useQuery } from '../api/client';
import type { AuditItem, Followup, Job } from '../api/types';
import { ago, date, longDate, money, time } from '../lib/format';
import { feeReminderText, waLink } from '../lib/whatsapp';
import { DueLabel } from './services/Jobs';

interface MyDash {
  fees_collected_today: { amount: string; receipts: number }; bills_closed_today: { amount: string; count: number }; jobs_completed_today: number;
  open_assigned_jobs: number; cash_to_hand_over: string; assigned_jobs: Job[]; fee_followups: Followup[];
  receipts_today: { receipt_no: string; student: string; at: string; mode: string; mode_label: string; amount: string }[]; recent_entries: AuditItem[];
}

/* Staff view of the dashboard: only the signed-in person's own day (resolved on the server from the session). */
export default function StaffDashboard() {
  const { user, can, toast } = useApp();
  const nav = useNavigate();
  const { data: d, error, loading, reload } = useQuery<MyDash>('/dashboard/me');
  if (error) return <LoadError error={error} retry={reload} />;
  if (loading || !d) return <SkeletonRows rows={8} cols={4} />;
  const access: [string, string][] = [
    ['Admissions', 'students.create'], ['Collect fees', 'fees.collect'], ['Fee reminders', 'reminders.view'], ['Service jobs', 'service_jobs.update'],
    ['Service bills', 'service_bill.create'], ['Add expenses', 'expenses.create'], ['Reports', 'reports.view'], ['Override bill rate', 'service_bill.rate_override'], ['Cancel bills', 'service_bill.cancel'],
  ];

  return (
    <>
      <div className="dayhead">
        <div>
          <div className="dayhead__date">{longDate(new Date())}</div>
          <h1>My counter</h1>
          <p className="dayhead__facts">
            {user.name}{user.designation && ` · ${user.designation}`}
            <span className="sep">·</span>
            {d.fees_collected_today.receipts} receipt{d.fees_collected_today.receipts === 1 ? '' : 's'} issued by you today
            <span className="sep">·</span>
            {d.open_assigned_jobs} job{d.open_assigned_jobs === 1 ? '' : 's'} assigned to you
          </p>
        </div>
      </div>

      <section className="ledger" aria-label="My day">
        <div className="ledger__group">
          <h2 className="ledger__title">My day</h2>
          <div className="ledger__cells">
            <Link to="/fees/payments" className="cell"><span>Fees I collected</span><strong>{money(d.fees_collected_today.amount)}</strong><small>{d.fees_collected_today.receipts} receipts</small></Link>
            <Link to="/services/bills" className="cell"><span>Service bills I closed</span><strong>{money(d.bills_closed_today.amount)}</strong><small>{d.bills_closed_today.count} paid bills</small></Link>
            <Link to="/services/jobs" className="cell"><span>Jobs I completed</span><strong>{d.jobs_completed_today}</strong><small>{d.open_assigned_jobs} still open</small></Link>
            <div className="cell cell--net"><span>Cash to hand over</span><strong>{money(d.cash_to_hand_over)}</strong><small>cash received − cash expenses</small></div>
          </div>
        </div>
      </section>

      <div className="dash-grid even">
        <div className="stack">
          <Panel flush title="Assigned to me" sub="Open service jobs where you are one of the assigned staff" actions={<Link to="/services/jobs" className="btn btn-ghost btn-sm">Job board</Link>}>
            {d.assigned_jobs.length === 0 ? <p className="muted" style={{ padding: 16, fontSize: 13 }}>Nothing assigned to you right now.</p> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Job</th><th>Service & customer</th><th>Last date</th><th>Status</th></tr></thead>
                  <tbody>
                    {d.assigned_jobs.map((j) => (
                      <tr key={j.code} className="is-clickable" onClick={() => nav(`/services/jobs/${j.code}`)}>
                        <td className="id">{j.code}</td>
                        <td style={{ whiteSpace: 'normal' }}><div style={{ fontWeight: 500 }}>{j.services[0]?.name}</div><div className="muted" style={{ fontSize: 12 }}>{j.customer.name}</div></td>
                        <td><DueLabel j={j} /></td>
                        <td><JobStatusBadge s={j.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {d.fee_followups.length > 0 && (
            <Panel flush title="Fee follow-ups" sub="Overdue and due today" actions={<Link to="/fees/reminders" className="btn btn-ghost btn-sm">All reminders</Link>}>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {d.fee_followups.map((st) => (
                      <tr key={st.code} className="is-clickable" onClick={() => nav(`/students/${st.code}`)}>
                        <td><Person name={st.name} sub={`${st.code} · ${st.mobile}`} /></td>
                        <td>
                          <div className="num" style={{ fontWeight: 600 }}>{money(st.installment_due)}</div>
                          <div style={{ fontSize: 12, color: st.overdue_days ? 'var(--danger-700)' : 'var(--accent-700)' }}>{st.overdue_days ? `${st.overdue_days} days overdue` : 'Due today'}</div>
                        </td>
                        <td className="ta-r" onClick={(e) => e.stopPropagation()}>
                          <div className="actions">
                            <a className="btn btn-whatsapp btn-sm" href={waLink(st.whatsapp_number || st.mobile, feeReminderText(st.name, st.installment_due, st.due_date, st.balance))} target="_blank" rel="noreferrer" onClick={() => toast('success', 'WhatsApp opened', st.name)}><MessageCircle /> Remind</a>
                            {can('fees.collect') && <Link className="btn btn-secondary btn-sm" to={`/fees/collect?student=${st.code}`}>Collect</Link>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </div>

        <div className="stack">
          <Panel flush title="My receipts today" actions={can('receipts.view_print') ? <Link to="/fees/receipts" className="btn btn-ghost btn-sm">All receipts</Link> : undefined}>
            {d.receipts_today.length === 0 ? <p className="muted" style={{ padding: 16, fontSize: 13 }}>No receipts issued by you yet today.</p> : (
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {d.receipts_today.map((p) => (
                      <tr key={p.receipt_no} className="is-clickable" onClick={() => nav(`/fees/receipts/${p.receipt_no}`)}>
                        <td className="id">{p.receipt_no}</td><td>{p.student}</td><td className="muted">{time(p.at)} · {p.mode_label}</td><td className="ta-r num" style={{ fontWeight: 600 }}>{money(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="My access" sub="Set by the administrator. Ask them if you need more.">
            <ul className="access-list">
              {access.map(([label, perm]) => {
                const ok = can(perm);
                return <li key={perm} className={ok ? 'ok' : 'no'}>{ok ? <Check /> : <Lock />}{label}</li>;
              })}
            </ul>
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>{user.permissions.length} permissions granted · Admin-only actions are locked for all staff.</p>
          </Panel>

          <Panel flush title="My recent entries">
            <div className="feed">
              {d.recent_entries.length === 0 && <p className="muted" style={{ padding: 16, fontSize: 13 }}>No entries yet.</p>}
              {d.recent_entries.map((a, i) => (
                <div className="feed-item" key={i}><div><p>{a.summary}</p><small>{ago(a.at)} · {date(a.at)}</small></div></div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
