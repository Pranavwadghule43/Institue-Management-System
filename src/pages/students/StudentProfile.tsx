import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BookOpen, CalendarDays, Clock, Eye, EyeOff, FileText, IndianRupee, MessageCircle, Pencil, Phone, Printer, ReceiptText, UserX,
} from 'lucide-react';
import { useApp } from '../../app/AppContext';
import {
  Avatar, Badge, Empty, FeeStateBadge, InstBadge, Menu, PageHeader, Panel, Progress, StatusDot, Tabs,
} from '../../components/ui';
import { balanceFor, db, feeState, netFee, nextDue, paidFor, scheduleFor, studentPayments, useStore } from '../../data/store';
import { date, dateTime, mask, money, pct, relDays } from '../../lib/format';
import { feeReminderText, waLink } from '../../lib/whatsapp';
import NotFound from '../NotFound';

type Tab = 'overview' | 'fees' | 'receipts' | 'activity';

export default function StudentProfile() {
  useStore();
  const { id } = useParams();
  const { can, role, toast } = useApp();
  const [tab, setTab] = useState<Tab>('overview');
  const [reveal, setReveal] = useState(false);
  const s = db.students.find((x) => x.id === id);
  if (!s) return <NotFound what="student" />;

  const course = db.courseById(s.courseId);
  const batch = db.batchById(s.batchId);
  const paid = paidFor(s);
  const bal = balanceFor(s);
  const n = nextDue(s);
  const pays = studentPayments(s);
  const sched = scheduleFor(s);
  const p = pct(paid, netFee(s));

  return (
    <>
      <PageHeader title="Student profile" crumbs={[['Students', '/students'], [s.name]]} />

      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="profile-head">
          <Avatar name={s.name} size="xl" />
          <div className="profile-head__meta">
            <h1>
              {s.name} <StatusDot s={s.status} /> <FeeStateBadge s={feeState(s)} />
            </h1>
            <div className="profile-head__facts">
              <span className="id">{s.id}</span>
              <span>
                <Phone /> {s.phone}
              </span>
              <span>
                <BookOpen /> {course.code} · {batch.name}
              </span>
              <span>
                <Clock /> {batch.timing}
              </span>
              <span>
                <CalendarDays /> Admitted {date(s.admissionDate)}
              </span>
            </div>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {n && (
              <a className="btn btn-whatsapp" href={waLink(s.phone, feeReminderText(s.name, n.remaining, n.due, bal))} target="_blank" rel="noreferrer">
                <MessageCircle /> Remind
              </a>
            )}
            {can('fees.collect') && bal > 0 && (
              <Link className="btn btn-primary" to={`/fees/collect?student=${s.id}`}>
                <IndianRupee /> Collect fee
              </Link>
            )}
            {can('students.edit') && (
              <button className="btn btn-secondary" onClick={() => toast('info', 'Edit student', 'Opens the admission form pre-filled for editing.')}>
                <Pencil /> Edit
              </button>
            )}
            <Menu>
              <button className="menu__item" onClick={() => toast('info', 'Batch transfer', 'Move this student to another batch of the same course.')}>
                <BookOpen /> Change batch
              </button>
              <button className="menu__item" onClick={() => window.print()}>
                <Printer /> Print profile
              </button>
              {can('students.delete') && (
                <>
                  <div className="menu__sep" />
                  <button className="menu__item danger" onClick={() => toast('info', 'Mark as dropped', 'Requires confirmation with a reason; history is preserved.')}>
                    <UserX /> Mark as dropped
                  </button>
                </>
              )}
            </Menu>
          </div>
        </div>
        <div className="fee-hero">
          <div>
            <span>Net fee</span>
            <strong>{money(netFee(s))}</strong>
            {s.discount > 0 && <div className="muted" style={{ fontSize: 12 }}>after {money(s.discount)} discount</div>}
          </div>
          <div>
            <span>Paid</span>
            <strong style={{ color: 'var(--success-700)' }}>{money(paid)}</strong>
            <div className="row" style={{ gap: 8, marginTop: 4 }}>
              <Progress value={p} tone="success" />
              <span className="muted num" style={{ fontSize: 12 }}>
                {p}%
              </span>
            </div>
          </div>
          <div>
            <span>Balance</span>
            <strong style={{ color: bal ? 'var(--danger-700)' : undefined }}>{money(bal)}</strong>
          </div>
          <div>
            <span>Next due</span>
            {n ? (
              <>
                <strong>{money(n.remaining)}</strong>
                <div style={{ fontSize: 12, fontWeight: 600, color: n.state === 'Overdue' ? 'var(--danger-700)' : 'var(--ink-3)' }}>
                  {date(n.due)} · {relDays(n.due)}
                </div>
              </>
            ) : (
              <strong style={{ color: 'var(--success-700)' }}>Fully paid</strong>
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div style={{ padding: '0 8px' }}>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'overview', label: 'Overview' },
              { value: 'fees', label: 'Fees & payments', count: pays.length },
              { value: 'receipts', label: 'Receipts', count: pays.filter((x) => x.status === 'Valid').length },
              { value: 'activity', label: 'Activity' },
            ]}
          />
        </div>

        {tab === 'overview' && (
          <div className="panel__body">
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
              <Panel title="Personal details">
                <dl className="kv-list">
                  <dt>Father / guardian</dt>
                  <dd>{s.fatherName}</dd>
                  <dt>Date of birth</dt>
                  <dd>{date(s.dob)}</dd>
                  <dt>Gender</dt>
                  <dd>{s.gender}</dd>
                  <dt>Mobile</dt>
                  <dd className="num">{s.phone}</dd>
                  <dt>Email</dt>
                  <dd>{s.email || <span className="muted">—</span>}</dd>
                  <dt>Address</dt>
                  <dd>{s.address}</dd>
                  <dt>Aadhaar</dt>
                  <dd className="num">
                    <span className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      {reveal ? s.aadhaar : mask(s.aadhaar)}
                      {role === 'Admin' && (
                        <button className="icon-btn sm" onClick={() => setReveal((r) => !r)} aria-label={reveal ? 'Hide Aadhaar' : 'Reveal Aadhaar (audited)'} data-tip={reveal ? 'Hide' : 'Reveal (audited)'}>
                          {reveal ? <EyeOff /> : <Eye />}
                        </button>
                      )}
                    </span>
                  </dd>
                </dl>
              </Panel>
              <Panel title="Enrolment">
                <dl className="kv-list">
                  <dt>Course</dt>
                  <dd>{course.name}</dd>
                  <dt>Duration</dt>
                  <dd>{course.duration} months</dd>
                  <dt>Batch</dt>
                  <dd>{batch.name}</dd>
                  <dt>Timing</dt>
                  <dd>
                    {batch.timing} · {batch.days}
                  </dd>
                  <dt>Faculty</dt>
                  <dd>{batch.teacher}</dd>
                  <dt>Agreed fee</dt>
                  <dd className="num">{money(s.courseFee)}</dd>
                  <dt>Discount</dt>
                  <dd className="num">{money(s.discount)}</dd>
                </dl>
              </Panel>
            </div>
          </div>
        )}

        {tab === 'fees' && (
          <>
            <div className="panel__head">
              <h2>Installment schedule</h2>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Due date</th>
                    <th className="ta-r">Amount</th>
                    <th className="ta-r">Paid</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sched.map((r) => (
                    <tr key={r.no}>
                      <td>{r.no === 0 ? 'Admission' : `Installment ${r.no}`}</td>
                      <td>{date(r.due)}</td>
                      <td className="ta-r num">{money(r.amount)}</td>
                      <td className="ta-r num">{money(r.paid)}</td>
                      <td>
                        <InstBadge s={r.state} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel__head" style={{ borderTop: '1px solid var(--line)' }}>
              <h2>Payment history</h2>
            </div>
            <PaymentsTable rows={pays} />
          </>
        )}

        {tab === 'receipts' &&
          (pays.length ? (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {pays
                    .filter((x) => x.status === 'Valid')
                    .map((x) => (
                      <tr key={x.id}>
                        <td>
                          <div className="row">
                            <span className="feed-item__ico money">
                              <ReceiptText />
                            </span>
                            <div>
                              <div className="id" style={{ fontWeight: 600, color: 'var(--ink)' }}>
                                {x.receiptNo}
                              </div>
                              <div className="muted" style={{ fontSize: 12 }}>
                                {dateTime(x.at)}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="ta-r num" style={{ fontWeight: 700 }}>
                          {money(x.amount)}
                        </td>
                        <td className="ta-r">
                          <Link className="btn btn-secondary btn-sm" to={`/fees/receipts/${x.receiptNo}`}>
                            <Printer /> View / print
                          </Link>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon={<FileText />} title="No receipts yet" body="Receipts appear here after the first fee payment." />
          ))}

        {tab === 'activity' && (
          <div className="panel__body">
            <div className="timeline">
              {pays.map((x) => (
                <div className="tl-item" key={x.id}>
                  <span className={`tl-item__dot ${x.status === 'Valid' ? 'success' : 'danger'}`}>
                    <IndianRupee />
                  </span>
                  <div className="tl-item__title">
                    {x.status === 'Valid' ? 'Fee received' : 'Payment reversed'} · {money(x.amount)} ({x.mode})
                  </div>
                  <div className="tl-item__meta">
                    {dateTime(x.at)} · by {db.staffById(x.by).name} · {x.receiptNo}
                  </div>
                  {x.remark && <div className="tl-item__note">{x.remark}</div>}
                </div>
              ))}
              {s.lastReminded && (
                <div className="tl-item">
                  <span className="tl-item__dot info">
                    <MessageCircle />
                  </span>
                  <div className="tl-item__title">WhatsApp fee reminder sent</div>
                  <div className="tl-item__meta">{date(s.lastReminded)}</div>
                </div>
              )}
              <div className="tl-item">
                <span className="tl-item__dot primary">
                  <BookOpen />
                </span>
                <div className="tl-item__title">
                  Admitted to {course.code} · {batch.name}
                </div>
                <div className="tl-item__meta">{dateTime(s.admissionDate)}</div>
              </div>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

export function PaymentsTable({ rows, showStudent }: { rows: ReturnType<typeof studentPayments>; showStudent?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Receipt</th>
            {showStudent && <th>Student</th>}
            <th>Date & time</th>
            <th>Mode</th>
            <th>Collected by</th>
            <th className="ta-r">Amount</th>
            <th>Status</th>
            <th className="ta-r" />
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => {
            const st = db.studentById(x.studentId);
            return (
              <tr key={x.id} style={x.status === 'Reversed' ? { opacity: 0.65 } : undefined}>
                <td className="id">{x.receiptNo}</td>
                {showStudent && (
                  <td>
                    <Link to={`/students/${st.id}`} style={{ color: 'inherit', fontWeight: 600 }}>
                      {st.name}
                    </Link>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {st.id}
                    </div>
                  </td>
                )}
                <td>{dateTime(x.at)}</td>
                <td>
                  <span className="tag">{x.mode}</span>
                  {x.reference && (
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                      {x.reference}
                    </div>
                  )}
                </td>
                <td>{db.staffById(x.by).name}</td>
                <td className="ta-r num" style={{ fontWeight: 700, textDecoration: x.status === 'Reversed' ? 'line-through' : undefined }}>
                  {money(x.amount)}
                </td>
                <td>{x.status === 'Valid' ? <Badge tone="success" dot>Valid</Badge> : <Badge tone="danger" dot>Reversed</Badge>}</td>
                <td className="ta-r">
                  <Link className="icon-btn sm" to={`/fees/receipts/${x.receiptNo}`} aria-label="View receipt" data-tip="Receipt">
                    <Printer />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
