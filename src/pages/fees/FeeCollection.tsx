import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, IndianRupee, MessageCircle, Printer, Search, X } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { Avatar, Confirm, Empty, FeeStateBadge, Field, InstBadge, Modal, MoneyInput, PageHeader, Panel, Progress } from '../../components/ui';
import { balanceFor, collectFee, db, feeState, netFee, nextDue, paidFor, scheduleFor, useStore } from '../../data/store';
import type { PayMode, Payment } from '../../data/types';
import { date, money, pct } from '../../lib/format';
import { receiptMessage } from '../../lib/whatsapp';
import { WhatsAppSend } from '../../components/WhatsAppSend';
import { PayModePicker } from '../../components/PayModePicker';
import { isDigital, PAY_LABEL } from '../../lib/payModes';


export default function FeeCollection() {
  useStore();
  const { user } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const sid = params.get('student');
  const student = sid ? db.students.find((s) => s.id === sid) : undefined;

  const [amount, setAmount] = useState<number | ''>('');
  const [mode, setMode] = useState<PayMode>('Cash');
  const [ref, setRef] = useState('');
  const [remark, setRemark] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Payment | null>(null);
  const [waP, setWaP] = useState<Payment | null>(null);

  const bal = student ? balanceFor(student) : 0;
  const nd = student ? nextDue(student) : null;
  useEffect(() => {
    setAmount(nd ? nd.remaining : '');
    setSubmitted(false);
    setRef('');
    setRemark('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid]);

  const errors = {
    amount: !amount ? 'Enter the amount received' : Number(amount) > bal ? `Amount can’t exceed the balance of ${money(bal)}` : '',
    ref: mode === 'Bank' && !ref.trim() ? 'Transaction / UTR reference is required for bank transfers' : '',
  };
  const valid = !errors.amount && !errors.ref;

  return (
    <>
      <PageHeader title="Fee collection" sub="Search a student, enter the amount received and print the receipt." crumbs={[['Student Finance'], ['Fee collection']]} />
      <div className="two-col wide-side">
        <div className="stack">
          <Panel title="1 · Student">
            {student ? (
              <div className="student-pick">
                <Avatar name={student.name} size="lg" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>
                    <Link to={`/students/${student.id}`} style={{ color: 'inherit' }}>
                      {student.name}
                    </Link>
                  </div>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    {student.id} · {student.phone} · {db.courseById(student.courseId).code} · {db.batchById(student.batchId).name}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <FeeStateBadge s={feeState(student)} />
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setParams({})}>
                  <X /> Change
                </button>
              </div>
            ) : (
              <StudentSearch onPick={(id) => setParams({ student: id })} />
            )}
            {student && (
              <>
                <div className="fee-hero" style={{ border: '1px solid var(--line)', borderRadius: 10, marginTop: 14 }}>
                  <div>
                    <span>Net fee</span>
                    <strong>{money(netFee(student))}</strong>
                  </div>
                  <div>
                    <span>Paid so far</span>
                    <strong style={{ color: 'var(--success-700)' }}>{money(paidFor(student))}</strong>
                  </div>
                  <div>
                    <span>Balance</span>
                    <strong style={{ color: bal ? 'var(--danger-700)' : undefined }}>{money(bal)}</strong>
                  </div>
                  <div>
                    <span>Progress</span>
                    <div className="row" style={{ marginTop: 8 }}>
                      <Progress value={pct(paidFor(student), netFee(student))} tone="success" />
                      <span className="num muted" style={{ fontSize: 12 }}>
                        {pct(paidFor(student), netFee(student))}%
                      </span>
                    </div>
                  </div>
                </div>
                <div className="table-wrap" style={{ marginTop: 14 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Installment</th>
                        <th>Due</th>
                        <th className="ta-r">Amount</th>
                        <th className="ta-r">Paid</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scheduleFor(student).map((r) => (
                        <tr key={r.no}>
                          <td>{r.no === 0 ? 'Admission' : `#${r.no}`}</td>
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
              </>
            )}
          </Panel>
        </div>

        <aside className="sticky-side">
          <section className="panel">
            <div className="panel__head">
              <h2>2 · Payment</h2>
              <span className="muted" style={{ fontSize: 12 }}>
                {date(new Date())}
              </span>
            </div>
            {!student ? (
              <Empty icon={<IndianRupee />} title="Select a student first" body="Search by name, mobile number or Student ID to load the fee summary." />
            ) : bal === 0 ? (
              <Empty icon={<CheckCircle2 />} title="Fees fully paid" body={`${student.name} has no pending balance.`} action={<Link className="btn btn-secondary" to={`/students/${student.id}`}>View profile</Link>} />
            ) : (
              <>
                <div className="panel__body stack" style={{ gap: 16 }}>
                  <Field label="Amount received" required error={submitted ? errors.amount : ''} htmlFor="amt">
                    <MoneyInput id="amt" xl value={amount} onChange={setAmount} />
                    <div className="amount-chips">
                      {nd && nd.remaining !== bal && (
                        <button type="button" className={`chip ${amount === nd.remaining ? 'is-active' : ''}`} onClick={() => setAmount(nd.remaining)}>
                          Next installment · {money(nd.remaining)}
                        </button>
                      )}
                      <button type="button" className={`chip ${amount === bal ? 'is-active' : ''}`} onClick={() => setAmount(bal)}>
                        Full balance · {money(bal)}
                      </button>
                    </div>
                  </Field>
                  <div className="field">
                    <span className="field__label">
                      Payment mode <span className="req">*</span>
                    </span>
                    <PayModePicker value={mode} onChange={setMode} />
                  </div>
                  {mode !== 'Cash' && (
                    <Field label={isDigital(mode) ? 'UPI transaction ID' : mode === 'Card' ? 'Card last 4 / approval code' : 'UTR / reference number'} required={mode === 'Bank'} error={submitted ? errors.ref : ''} htmlFor="ref">
                      <input id="ref" className="input" value={ref} onChange={(e) => setRef(e.target.value)} />
                    </Field>
                  )}
                  <Field label="Remarks" htmlFor="rem">
                    <input id="rem" className="input" value={remark} onChange={(e) => setRemark(e.target.value)} />
                  </Field>
                </div>
                <div className="panel__foot" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                  {amount && Number(amount) <= bal ? (
                    <div className="row-between" style={{ fontSize: 13 }}>
                      <span className="muted">Balance after payment</span>
                      <strong className="num">{money(bal - Number(amount))}</strong>
                    </div>
                  ) : null}
                  <button
                    className="btn btn-accent btn-lg btn-block"
                    onClick={() => {
                      setSubmitted(true);
                      if (valid) setConfirm(true);
                    }}
                  >
                    <IndianRupee /> Collect {amount ? money(Number(amount)) : 'fee'}
                  </button>
                </div>
              </>
            )}
          </section>
        </aside>
      </div>

      {student && (
        <Confirm
          open={confirm}
          onClose={() => setConfirm(false)}
          icon={<IndianRupee />}
          title={`Collect ${money(Number(amount))}?`}
          body="Please confirm the amount and student before saving. A receipt number will be issued."
          confirmLabel="Confirm & save"
          busy={busy}
          onConfirm={() => {
            setBusy(true);
            setTimeout(() => {
              const p = collectFee(student.id, Number(amount), mode, ref, remark, user.id);
              setBusy(false);
              setConfirm(false);
              setDone(p);
            }, 800);
          }}
        >
          <div className="summary-box">
            <div className="kv">
              <span>Student</span>
              <strong>
                {student.name} · {student.id}
              </strong>
            </div>
            <div className="kv">
              <span>Mode</span>
              <strong>
                {mode}
                {ref && ` · ${ref}`}
              </strong>
            </div>
            <div className="kv">
              <span>Balance after</span>
              <strong>{money(bal - Number(amount || 0))}</strong>
            </div>
            <div className="kv total">
              <span>Amount</span>
              <strong>{money(Number(amount || 0))}</strong>
            </div>
          </div>
        </Confirm>
      )}

      {waP && student && (
        <WhatsAppSend
          open
          onClose={() => setWaP(null)}
          title={`Send receipt ${waP.receiptNo}`}
          name={student.name}
          phone={student.phone}
          message={receiptMessage({
            name: student.name, studentId: student.id, course: `${db.courseById(student.courseId).code} — ${db.courseById(student.courseId).name}`, receiptNo: waP.receiptNo,
            at: waP.at, amount: waP.amount, mode: PAY_LABEL[waP.mode], paidTillDate: paidFor(student), netFee: netFee(student), balance: balanceFor(student),
          })}
          onPdf={() => nav(`/fees/receipts/${waP.receiptNo}`)}
        />
      )}

      <Modal open={!!done} onClose={() => setDone(null)}>
        {done && student && (
          <>
            <div className="modal__head">
              <div className="modal__icon success">
                <CheckCircle2 />
              </div>
              <div>
                <h2>Payment recorded</h2>
                <p>
                  {money(done.amount)} received from <strong>{student.name}</strong>. Receipt <span className="id">{done.receiptNo}</span> is ready.
                </p>
              </div>
            </div>
            <div style={{ height: 16 }} />
            <div className="modal__foot">
              <button
                className="btn btn-whatsapp"
                onClick={() => {
                  setWaP(done);
                  setDone(null);
                }}
              >
                <MessageCircle /> Send on WhatsApp
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setDone(null);
                  setParams({});
                }}
              >
                Collect another
              </button>
              <button className="btn btn-primary" onClick={() => nav(`/fees/receipts/${done.receiptNo}`)}>
                <Printer /> Print receipt
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

function StudentSearch({ onPick }: { onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/\s/g, '');
    const base = db.students.filter((x) => x.status !== 'Left');
    if (!s) return base.filter((x) => ['Overdue', 'Due Today'].includes(feeState(x))).slice(0, 6);
    return base.filter((x) => x.name.toLowerCase().replace(/\s/g, '').includes(s) || x.id.toLowerCase().includes(s) || x.phone.replace(/\s/g, '').includes(s)).slice(0, 8);
  }, [q]);
  return (
    <div className="combo">
      <div className="input-group">
        <Search />
        <input
          ref={ref}
          className="input"
          style={{ height: 46, fontSize: 15 }}
          placeholder="Search by name, mobile or Student ID…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(results.length - 1, a + 1));
            if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
            if (e.key === 'Enter' && results[active]) onPick(results[active].id);
          }}
          aria-label="Search student"
        />
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="menu__label" style={{ padding: '6px 4px' }}>
          {q ? `${results.length} matches` : 'Due today & overdue'}
        </div>
        {results.length === 0 && <p className="muted" style={{ fontSize: 13, padding: '10px 4px' }}>No student found. Check the spelling or try the mobile number.</p>}
        {results.map((s, i) => (
          <button key={s.id} className={`combo__item ${i === active ? 'is-active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => onPick(s.id)}>
            <Avatar name={s.name} size="sm" />
            <span>
              <strong style={{ fontWeight: 600, fontSize: 13.5 }}>{s.name}</strong>
              <br />
              <small className="muted">
                {s.id} · {s.phone} · {db.courseById(s.courseId).code}
              </small>
            </span>
            <span className="bal">
              <strong className="num">{money(balanceFor(s))}</strong>
              <br />
              <small className="muted">balance</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
