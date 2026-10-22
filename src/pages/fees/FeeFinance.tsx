import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Download, FileDown, IndianRupee, MessageCircle, Printer, Search, SearchX, Undo2 } from 'lucide-react';
import logo from '../../assets/logo.png';
import { useApp } from '../../app/AppContext';
import {
  Badge, Confirm, Empty, Field, Modal, PageHeader, Pagination, Person, Segmented, SkeletonRows, Tabs, useDebounced, useLoading, usePaged,
} from '../../components/ui';
import { balanceFor, db, feeState, isToday, markReminded, nextDue, overdueDays, sum, touch, useStore } from '../../data/store';
import type { PayMode } from '../../data/types';
import { PAY_LABEL, PAY_MODES } from '../../lib/payModes';
import { amountInWords, date, money, relDays, time } from '../../lib/format';
import { institute } from '../../lib/institute';
import { feeReminderText, receiptMessage, waLink } from '../../lib/whatsapp';
import { WhatsAppSend } from '../../components/WhatsAppSend';
import { PaymentsTable } from '../students/StudentProfile';
import NotFound from '../NotFound';

/* ------------------------------ Payment history / receipts ------------------------------ */

export function PaymentHistory({ receipts }: { receipts?: boolean }) {
  useStore();
  const { toast } = useApp();
  const [q, setQ] = useState('');
  const [range, setRange] = useState<'today' | '7' | '30' | 'all'>(receipts ? '30' : '7');
  const [mode, setMode] = useState<'' | PayMode>('');
  const dq = useDebounced(q);
  const loading = useLoading(450, [range]);

  const rows = useMemo(() => {
    const s = dq.trim().toLowerCase();
    const from = range === 'today' ? db.TODAY : range === 'all' ? new Date(0) : db.day(-Number(range) + 1, 0, 0);
    return [...db.payments]
      .reverse()
      .filter((p) => p.at >= from)
      .filter((p) => !receipts || p.status === 'Valid')
      .filter((p) => !mode || p.mode === mode)
      .filter((p) => {
        if (!s) return true;
        const st = db.studentById(p.studentId);
        return p.receiptNo.toLowerCase().includes(s) || st.name.toLowerCase().includes(s) || st.id.toLowerCase().includes(s);
      });
  }, [dq, range, mode, receipts, db.payments.length]);
  const pg = usePaged(rows, 12);
  const valid = rows.filter((r) => r.status === 'Valid');
  const byMode = PAY_MODES.map((m) => [m, sum(valid.filter((r) => r.mode === m), (r) => r.amount)] as const);

  return (
    <>
      <PageHeader
        title={receipts ? 'Receipts' : 'Payment history'}
        sub={receipts ? 'Every fee receipt issued — reprint, download or share on WhatsApp.' : 'All student fee payments, including reversed entries kept for audit.'}
        crumbs={[['Student Finance'], [receipts ? 'Receipts' : 'Payment history']]}
        actions={
          <button className="btn btn-secondary" onClick={() => toast('success', 'Export ready', `${rows.length} payments exported to Excel`)}>
            <Download /> Export
          </button>
        }
      />
      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="ledger-sum">
          <div>
            <span>Total collected</span>
            <strong>{money(sum(valid, (r) => r.amount))}</strong>
            <div className="muted" style={{ fontSize: 12 }}>
              {valid.length} receipts
            </div>
          </div>
          {byMode.slice(0, 3).map(([m, v]) => (
            <div key={m}>
              <span>{m}</span>
              <strong>{money(v)}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                {valid.length ? Math.round((v / Math.max(1, sum(valid, (r) => r.amount))) * 100) : 0}% of total
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="table-toolbar">
          <div className="input-group">
            <Search />
            <input className="input" placeholder="Receipt no, student name or ID…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search payments" />
          </div>
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: 'today', label: 'Today' },
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
              { value: 'all', label: 'All' },
            ]}
          />
          <select className="select" value={mode} onChange={(e) => setMode(e.target.value as PayMode | '')} aria-label="Payment mode">
            <option value="">All modes</option>
            {PAY_MODES.map((m) => (
              <option key={m} value={m}>{PAY_LABEL[m]}</option>
            ))}
          </select>
        </div>
        {loading ? (
          <SkeletonRows rows={8} cols={6} />
        ) : rows.length === 0 ? (
          <Empty icon={<SearchX />} title="No payments found" body="No payments match this period or search. Try a wider date range." />
        ) : (
          <>
            <PaymentsTable rows={pg.slice} showStudent />
            <Pagination {...pg} noun={receipts ? 'receipts' : 'payments'} />
          </>
        )}
      </section>
    </>
  );
}

/* ------------------------------ Receipt (UX-009) ------------------------------ */

export function ReceiptView() {
  useStore();
  const { no } = useParams();
  const { role, user, toast } = useApp();
  const [rev, setRev] = useState(false);
  const [reason, setReason] = useState('');
  const [wa, setWa] = useState(false);
  const p = db.payments.find((x) => x.receiptNo === no);
  if (!p) return <NotFound what="receipt" />;
  const s = db.studentById(p.studentId);
  const course = db.courseById(s.courseId);
  const before = sum(db.payments.filter((x) => x.studentId === s.id && x.status === 'Valid' && x.at < p.at), (x) => x.amount);
  const balanceAfter = Math.max(0, s.courseFee - s.discount - before - (p.status === 'Valid' ? p.amount : 0));

  return (
    <>
      <PageHeader
        title={`Receipt ${p.receiptNo}`}
        crumbs={[['Student Finance'], ['Receipts', '/fees/receipts'], [p.receiptNo]]}
        actions={
          <>
            {role === 'Admin' && p.status === 'Valid' && (
              <button className="btn btn-danger-soft" onClick={() => setRev(true)}>
                <Undo2 /> Reverse
              </button>
            )}
            {p.status === 'Valid' && (
              <button className="btn btn-whatsapp" onClick={() => setWa(true)}>
                <MessageCircle /> Send on WhatsApp
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => window.print()}>
              <FileDown /> PDF
            </button>
            <button className="btn btn-primary" onClick={() => window.print()}>
              <Printer /> Print
            </button>
          </>
        }
      />
      <article className="paper">
        <div className="paper__band" />
        <div className="paper__head">
          <img src={logo} alt={institute.name} />
          <div className="paper__inst">
            <strong>{institute.name}</strong>
            {institute.tagline}
            <br />
            {institute.address}
            <br />
            {institute.phone} · {institute.email}
          </div>
        </div>
        <div className="paper__title">
          <h2>Fee Receipt</h2>
          <div style={{ textAlign: 'right', fontSize: 12.5 }}>
            <div className="no">No. {p.receiptNo}</div>
            <div style={{ color: '#7a8699' }}>
              {date(p.at)}, {time(p.at)}
            </div>
          </div>
        </div>
        {p.status === 'Reversed' && <div className="stamp cancelled">REVERSED</div>}
        {p.status === 'Valid' && <div className="stamp">PAID</div>}
        <div className="paper__body">
          <div className="paper__grid">
            <div>
              <span>Student name</span>
              <strong>{s.name}</strong>
            </div>
            <div>
              <span>Student ID</span>
              <strong>{s.id}</strong>
            </div>
            <div>
              <span>Father’s name</span>
              <strong>{s.fatherName}</strong>
            </div>
            <div>
              <span>Mobile</span>
              <strong>{s.phone}</strong>
            </div>
            <div>
              <span>Course</span>
              <strong>
                {course.code} — {course.name}
              </strong>
            </div>
            <div>
              <span>Batch</span>
              <strong>{db.batchById(s.batchId).name}</strong>
            </div>
            <div>
              <span>Payment mode</span>
              <strong>
                {PAY_LABEL[p.mode]}
                {p.reference && ` · ${p.reference}`}
              </strong>
            </div>
            <div>
              <span>Received by</span>
              <strong>{db.staffById(p.by).name}</strong>
            </div>
          </div>
          <div className="paper__amount">
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#4a5568', letterSpacing: '.06em', textTransform: 'uppercase' }}>Amount received</div>
              <div className="big num">{money(p.amount)}</div>
              <small>{amountInWords(p.amount)}</small>
            </div>
            <div style={{ textAlign: 'right', fontSize: 13 }}>
              <div>
                Net course fee: <strong className="num">{money(s.courseFee - s.discount)}</strong>
              </div>
              <div>
                Paid till date: <strong className="num">{money(before + (p.status === 'Valid' ? p.amount : 0))}</strong>
              </div>
              <div style={{ fontSize: 15, marginTop: 4 }}>
                Balance: <strong className="num">{money(balanceAfter)}</strong>
              </div>
            </div>
          </div>
          {p.remark && (
            <p style={{ marginTop: 14, fontSize: 12.5, color: '#4a5568' }}>
              <strong>Remark:</strong> {p.remark}
            </p>
          )}
        </div>
        <div className="paper__foot">
          <div style={{ maxWidth: 380 }}>{institute.receiptFooter}<br />This is a computer-generated receipt.</div>
          <div className="paper__sign">
            <i>{db.staffById(p.by).name.split(' ')[0]}</i>
            <div>Authorised signatory</div>
          </div>
        </div>
      </article>

      <WhatsAppSend
        open={wa}
        onClose={() => setWa(false)}
        title={`Send receipt ${p.receiptNo}`}
        name={s.name}
        phone={s.phone}
        message={receiptMessage({ name: s.name, studentId: s.id, course: `${course.code} — ${course.name}`, receiptNo: p.receiptNo, at: p.at, amount: p.amount, mode: PAY_LABEL[p.mode], paidTillDate: before + p.amount, netFee: s.courseFee - s.discount, balance: balanceAfter })}
        onPdf={() => window.print()}
        onOpened={() => {
          db.audit.unshift({ id: `W${Date.now()}`, at: new Date(), actor: user.id, action: 'RECEIPT_SHARED', entity: 'Payment', entityId: p.receiptNo, summary: `Receipt ${p.receiptNo} opened in WhatsApp for ${s.name}`, ip: '192.168.1.11' });
          touch();
          toast('success', 'WhatsApp opened', `Receipt ready to send to ${s.name}`);
        }}
      />

      <Confirm
        open={rev}
        onClose={() => setRev(false)}
        tone="danger"
        icon={<Undo2 />}
        title={`Reverse ${money(p.amount)} from ${s.name}?`}
        body="The receipt stays in history marked REVERSED and the amount is added back to the student’s balance. This is recorded in the audit log."
        confirmLabel="Reverse payment"
        disabled={reason.trim().length < 5}
        onConfirm={() => {
          p.status = 'Reversed';
          p.remark = reason;
          db.audit.unshift({ id: `R${Date.now()}`, at: new Date(), actor: user.id, action: 'PAYMENT_REVERSED', entity: 'Payment', entityId: p.receiptNo, summary: `Payment reversed — ${reason}`, ip: '192.168.1.11', before: { status: 'Valid' }, after: { status: 'Reversed' } });
          touch();
          setRev(false);
          toast('success', 'Payment reversed', `${p.receiptNo} · balance updated`);
        }}
      >
        <Field label="Reason for reversal" required hint="Minimum 5 characters — shown in the audit log" htmlFor="rr">
          <textarea id="rr" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Confirm>
    </>
  );
}

/* ------------------------------ Fee reminders (UX-010) ------------------------------ */

type RTab = 'Today' | 'Tomorrow' | 'Overdue' | 'Pending' | 'Fully Paid';

export function FeeReminders() {
  useStore();
  const { can, toast } = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<RTab>((params.get('tab') as RTab) || 'Overdue');
  const [preview, setPreview] = useState<{ id: string; text: string } | null>(null);
  const loading = useLoading(400, [tab]);

  const active = db.students.filter((s) => s.status === 'Active');
  const groups: Record<RTab, typeof active> = {
    Today: active.filter((s) => feeState(s) === 'Due Today'),
    Tomorrow: active.filter((s) => feeState(s) === 'Due Tomorrow'),
    Overdue: active.filter((s) => feeState(s) === 'Overdue').sort((a, b) => overdueDays(b) - overdueDays(a)),
    Pending: active.filter((s) => feeState(s) !== 'Fully Paid').sort((a, b) => balanceFor(b) - balanceFor(a)),
    'Fully Paid': db.students.filter((s) => feeState(s) === 'Fully Paid'),
  };
  const list = groups[tab];
  const pg = usePaged(list, 12);
  const total = sum(list, (s) => nextDue(s)?.remaining ?? 0);

  return (
    <>
      <PageHeader
        title="Fee reminders"
        sub="Open WhatsApp with a ready message — nothing is sent automatically."
        crumbs={[['Student Finance'], ['Fee reminders']]}
      />
      <section className="panel">
        <div style={{ padding: '0 8px' }}>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={(Object.keys(groups) as RTab[]).map((t) => ({ value: t, label: t === 'Today' ? 'Due today' : t === 'Tomorrow' ? 'Due tomorrow' : t, count: groups[t].length, alert: t === 'Overdue' }))}
          />
        </div>
        {tab !== 'Fully Paid' && list.length > 0 && (
          <div className="table-toolbar" style={{ justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>
              <strong>{list.length}</strong> students · <strong className="num">{money(total)}</strong> due in this list
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              Tip: each WhatsApp opens in a new tab with the message pre-filled.
            </span>
          </div>
        )}
        {loading ? (
          <SkeletonRows rows={6} cols={6} />
        ) : list.length === 0 ? (
          <Empty icon={<IndianRupee />} title={tab === 'Fully Paid' ? 'No fully paid students yet' : 'Nothing due here'} body={tab === 'Today' ? 'No installments are due today. Check Overdue for older dues.' : 'All caught up for this list.'} />
        ) : (
          <>
            <div className="table-wrap responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Mobile</th>
                    <th>Course</th>
                    {tab !== 'Fully Paid' && <th>Due date</th>}
                    <th className="ta-r">{tab === 'Fully Paid' ? 'Total paid' : 'Installment due'}</th>
                    {tab !== 'Fully Paid' && <th className="ta-r">Total balance</th>}
                    <th>Last reminded</th>
                    <th className="ta-r" />
                  </tr>
                </thead>
                <tbody>
                  {pg.slice.map((s) => {
                    const n = nextDue(s);
                    const od = overdueDays(s);
                    return (
                      <tr key={s.id} className="is-clickable" onClick={() => nav(`/students/${s.id}`)}>
                        <td>
                          <Person name={s.name} sub={s.id} />
                        </td>
                        <td className="num">{s.phone}</td>
                        <td>{db.courseById(s.courseId).code}</td>
                        {tab !== 'Fully Paid' && (
                          <td>
                            {n && date(n.due)}
                            <div style={{ fontSize: 12, fontWeight: 600, color: od ? 'var(--danger-700)' : 'var(--ink-3)' }}>{od ? `${od} days overdue` : n && relDays(n.due)}</div>
                          </td>
                        )}
                        <td className="ta-r num" style={{ fontWeight: 700 }}>
                          {money(tab === 'Fully Paid' ? s.courseFee - s.discount : n?.remaining ?? 0)}
                        </td>
                        {tab !== 'Fully Paid' && <td className="ta-r num">{money(balanceFor(s))}</td>}
                        <td>{s.lastReminded ? (isToday(s.lastReminded) ? <Badge tone="success" dot>Today</Badge> : <span className="muted">{relDays(s.lastReminded)}</span>) : <span className="muted">Never</span>}</td>
                        <td className="ta-r" onClick={(e) => e.stopPropagation()}>
                          <div className="actions">
                            {n && (
                              <button className="btn btn-whatsapp btn-sm" onClick={() => setPreview({ id: s.id, text: feeReminderText(s.name, n.remaining, n.due, balanceFor(s)) })}>
                                <MessageCircle /> Remind
                              </button>
                            )}
                            {n && can('fees.collect') && (
                              <Link className="btn btn-secondary btn-sm" to={`/fees/collect?student=${s.id}`}>
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
            <div className="card-list">
              {pg.slice.map((s) => {
                const n = nextDue(s);
                return (
                  <div key={s.id} className="m-card">
                    <div className="m-card__row">
                      <Person name={s.name} sub={`${s.id} · ${s.phone}`} to={`/students/${s.id}`} />
                      <strong className="num">{money(n?.remaining ?? 0)}</strong>
                    </div>
                    {n && (
                      <div className="m-card__row">
                        <span className="muted" style={{ fontSize: 12 }}>
                          Due {date(n.due)}
                        </span>
                        <button className="btn btn-whatsapp btn-sm" onClick={() => setPreview({ id: s.id, text: feeReminderText(s.name, n.remaining, n.due, balanceFor(s)) })}>
                          <MessageCircle /> Remind
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <Pagination {...pg} noun="students" />
          </>
        )}
      </section>

      <Modal open={!!preview} onClose={() => setPreview(null)}>
        {preview && (
          <>
            <div className="modal__head">
              <div className="modal__icon success">
                <MessageCircle />
              </div>
              <div>
                <h2>WhatsApp reminder</h2>
                <p>
                  To {db.studentById(preview.id).name} · {db.studentById(preview.id).phone}
                </p>
              </div>
            </div>
            <div className="modal__body">
              <Field label="Message" hint="You can edit the text before opening WhatsApp" htmlFor="wamsg">
                <textarea id="wamsg" className="textarea" rows={7} value={preview.text} onChange={(e) => setPreview({ ...preview, text: e.target.value })} />
              </Field>
            </div>
            <div className="modal__foot">
              <button className="btn btn-secondary" onClick={() => setPreview(null)}>
                Cancel
              </button>
              <a
                className="btn btn-whatsapp"
                href={waLink(db.studentById(preview.id).phone, preview.text)}
                target="_blank"
                rel="noreferrer"
                onClick={() => {
                  markReminded(preview.id);
                  toast('success', 'Reminder marked as sent', db.studentById(preview.id).name);
                  setPreview(null);
                }}
              >
                <MessageCircle /> Open WhatsApp
              </a>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

