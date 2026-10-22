import { Link, useNavigate } from 'react-router-dom';
import { Check, Lock, MessageCircle } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { JobStatusBadge, Panel, Person } from '../components/ui';
import { balanceFor, db, feeState, isToday, nextDue, overdueDays, sum, useStore } from '../data/store';
import { ago, date, longDate, money, time } from '../lib/format';
import { PAY_LABEL } from '../lib/payModes';
import { feeReminderText, waLink } from '../lib/whatsapp';
import { DueLabel } from './services/Jobs';

/* Staff view of the dashboard (Staff role, permission-driven — 05_USER_ROLES).
   Shows only the signed-in person's own day: what they collected, the jobs assigned
   to them, follow-ups they can act on, and what they're allowed to do. */
export default function StaffDashboard() {
  useStore();
  const { user, can, staffPerms, toast } = useApp();
  const nav = useNavigate();

  const myPayments = db.payments.filter((p) => p.by === user.id && p.status === 'Valid' && isToday(p.at)).sort((a, b) => b.at.getTime() - a.at.getTime());
  const myBills = db.bills.filter((b) => b.by === user.id && b.status === 'Paid' && b.paidAt && isToday(b.paidAt));
  const myExpenses = db.expenses.filter((e) => e.by === user.id && isToday(e.date));
  const myJobs = db.jobs
    .filter((j) => j.assignees.includes(user.id) && ['Pending', 'In Process', 'On Hold'].includes(j.status))
    .sort((a, b) => a.lastDate.getTime() - b.lastDate.getTime());
  const myDoneToday = db.jobs.filter((j) => j.assignees.includes(user.id) && j.history.some((h) => h.status === 'Completed' && h.by === user.id && isToday(h.at))).length;
  const myActivity = db.audit.filter((a) => a.actor === user.id).slice(0, 6);
  const followUps = can('reminders.view')
    ? db.students
        .filter((x) => x.status === 'Active' && ['Overdue', 'Due Today'].includes(feeState(x)))
        .sort((a, b) => overdueDays(b) - overdueDays(a))
        .slice(0, 6)
    : [];

  const cashInHand = sum(myPayments.filter((p) => p.mode === 'Cash'), (p) => p.amount) + sum(myBills.filter((b) => b.mode === 'Cash'), db.billTotal) - sum(myExpenses.filter((e) => e.mode === 'Cash'), (e) => e.amount);
  const perms = staffPerms[user.id] ?? new Set<string>();
  const access: [string, string][] = [
    ['Admissions', 'students.create'],
    ['Collect fees', 'fees.collect'],
    ['Fee reminders', 'reminders.view'],
    ['Service jobs', 'service_jobs.update'],
    ['Service bills', 'service_bill.create'],
    ['Add expenses', 'expenses.create'],
    ['Reports', 'reports.view'],
    ['Override bill rate', 'service_bill.rate_override'],
    ['Cancel bills', 'service_bill.cancel'],
  ];

  return (
    <>
      <div className="dayhead">
        <div>
          <div className="dayhead__date">{longDate(new Date())}</div>
          <h1>My counter</h1>
          <p className="dayhead__facts">
            {user.name} · {user.designation}
            <span className="sep">·</span>
            {myPayments.length} receipt{myPayments.length === 1 ? '' : 's'} issued by you today
            <span className="sep">·</span>
            {myJobs.length} job{myJobs.length === 1 ? '' : 's'} assigned to you
          </p>
        </div>
      </div>


      <section className="ledger" aria-label="My day">
        <div className="ledger__group">
          <h2 className="ledger__title">My day</h2>
          <div className="ledger__cells">
            <Link to="/fees/payments" className="cell">
              <span>Fees I collected</span>
              <strong>{money(sum(myPayments, (p) => p.amount))}</strong>
              <small>{myPayments.length} receipts</small>
            </Link>
            <Link to="/services/bills" className="cell">
              <span>Service bills I closed</span>
              <strong>{money(sum(myBills, db.billTotal))}</strong>
              <small>{myBills.length} paid bills</small>
            </Link>
            <Link to="/services/jobs" className="cell">
              <span>Jobs I completed</span>
              <strong>{myDoneToday}</strong>
              <small>{myJobs.length} still open</small>
            </Link>
            <div className="cell cell--net">
              <span>Cash to hand over</span>
              <strong>{money(cashInHand)}</strong>
              <small>cash received − cash expenses</small>
            </div>
          </div>
        </div>
      </section>

      <div className="dash-grid even">
        <div className="stack">
          <Panel flush title="Assigned to me" sub="Open service jobs where you are one of the assigned staff" actions={<Link to="/services/jobs" className="btn btn-ghost btn-sm">Job board</Link>}>
            {myJobs.length === 0 ? (
              <p className="muted" style={{ padding: 16, fontSize: 13 }}>
                Nothing assigned to you right now.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Service & customer</th>
                      <th>Last date</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myJobs.map((j) => (
                      <tr key={j.id} className="is-clickable" onClick={() => nav(`/services/jobs/${j.id}`)}>
                        <td className="id">{j.id}</td>
                        <td style={{ whiteSpace: 'normal' }}>
                          <div style={{ fontWeight: 500 }}>
                            {db.serviceById(j.serviceIds[0]).name}
                          </div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {db.customerById(j.customerId).name}
                          </div>
                        </td>
                        <td>
                          <DueLabel j={j} />
                        </td>
                        <td>
                          <JobStatusBadge s={j.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {followUps.length > 0 && (
            <Panel flush title="Fee follow-ups" sub="Overdue and due today" actions={<Link to="/fees/reminders" className="btn btn-ghost btn-sm">All reminders</Link>}>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {followUps.map((st) => {
                      const n = nextDue(st)!;
                      const od = overdueDays(st);
                      return (
                        <tr key={st.id} className="is-clickable" onClick={() => nav(`/students/${st.id}`)}>
                          <td>
                            <Person name={st.name} sub={`${st.id} · ${st.phone}`} />
                          </td>
                          <td>
                            <div className="num" style={{ fontWeight: 600 }}>
                              {money(n.remaining)}
                            </div>
                            <div style={{ fontSize: 12, color: od ? 'var(--danger-700)' : 'var(--accent-700)' }}>{od ? `${od} days overdue` : 'Due today'}</div>
                          </td>
                          <td className="ta-r" onClick={(e) => e.stopPropagation()}>
                            <div className="actions">
                              <a className="btn btn-whatsapp btn-sm" href={waLink(st.phone, feeReminderText(st.name, n.remaining, n.due, balanceFor(st)))} target="_blank" rel="noreferrer" onClick={() => toast('success', 'WhatsApp opened', st.name)}>
                                <MessageCircle /> Remind
                              </a>
                              {can('fees.collect') && (
                                <Link className="btn btn-secondary btn-sm" to={`/fees/collect?student=${st.id}`}>
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
          )}
        </div>

        <div className="stack">
          <Panel flush title="My receipts today" actions={<Link to="/fees/receipts" className="btn btn-ghost btn-sm">All receipts</Link>}>
            {myPayments.length === 0 ? (
              <p className="muted" style={{ padding: 16, fontSize: 13 }}>
                No receipts issued by you yet today.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {myPayments.slice(0, 6).map((p) => (
                      <tr key={p.id} className="is-clickable" onClick={() => nav(`/fees/receipts/${p.receiptNo}`)}>
                        <td className="id">{p.receiptNo}</td>
                        <td>{db.studentById(p.studentId).name}</td>
                        <td className="muted">
                          {time(p.at)} · {PAY_LABEL[p.mode]}
                        </td>
                        <td className="ta-r num" style={{ fontWeight: 600 }}>
                          {money(p.amount)}
                        </td>
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
                return (
                  <li key={perm} className={ok ? 'ok' : 'no'}>
                    {ok ? <Check /> : <Lock />}
                    {label}
                  </li>
                );
              })}
            </ul>
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              {perms.size} permissions granted · Admin-only actions are locked for all staff.
            </p>
          </Panel>

          <Panel flush title="My recent entries">
            <div className="feed">
              {myActivity.length === 0 && <p className="muted" style={{ padding: 16, fontSize: 13 }}>No entries yet.</p>}
              {myActivity.map((a) => (
                <div className="feed-item" key={a.id}>
                  <div>
                    <p>{a.summary}</p>
                    <small>
                      {ago(a.at)} · {date(a.at)}
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
