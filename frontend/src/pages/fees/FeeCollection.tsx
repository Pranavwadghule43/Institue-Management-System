import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, IndianRupee, MessageCircle, Printer, Search, X } from 'lucide-react';
import { errText, useApp } from '../../app/AppContext';
import { Avatar, Confirm, Empty, FeeStateBadge, Field, InstBadge, LoadError, Modal, MoneyInput, PageHeader, Panel, Progress, SkeletonRows, useDebounced } from '../../components/ui';
import { api, newKey, useQuery, write, type Page } from '../../api/client';
import type { FeeSummary, PayMode, Payment, Receipt, StudentRow } from '../../api/types';
import { date, money, n } from '../../lib/format';
import { receiptMessage } from '../../lib/whatsapp';
import { WhatsAppSend } from '../../components/WhatsAppSend';
import { PayModePicker } from '../../components/PayModePicker';
import { receiptPdf } from '../../components/PrintDocs';
import { isDigital } from '../../lib/payModes';

type Summary = FeeSummary & { student: { code: string; name: string; mobile: string; whatsapp_number?: string; status: string; course: { code: string; name: string }; time_slot: string } };

export default function FeeCollection() {
  const { toast } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const sid = params.get('student');
  const { data: sum, error } = useQuery<Summary>(sid ? `/fees/students/${sid}/summary` : null);

  const [amount, setAmount] = useState<number | ''>('');
  const [mode, setMode] = useState<PayMode>('Cash');
  const [ref, setRef] = useState('');
  const [remark, setRemark] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ payment: Payment; receipt: Receipt } | null>(null);
  const [wa, setWa] = useState<Receipt | null>(null);
  const key = useRef(newKey());

  const bal = n(sum?.balance);
  const nd = sum?.next_due;
  useEffect(() => {
    setAmount(nd ? n(nd.amount) : '');
    setSubmitted(false);
    setRef('');
    setRemark('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, sum?.student.code]);

  const errors = {
    amount: !amount ? 'Enter the amount received' : Number(amount) > bal ? `Amount can’t exceed the balance of ${money(bal)}` : '',
    ref: mode === 'Bank' && !ref.trim() ? 'Transaction / UTR reference is required for bank transfers' : '',
  };
  const valid = !errors.amount && !errors.ref;

  const collect = async () => {
    setBusy(true);
    try {
      const r = await write(api<{ payment: Payment; receipt: Receipt }>(`/fees/students/${sid}/payments`, {
        method: 'POST', idempotencyKey: key.current, body: { amount: String(amount), payment_mode: mode, reference: ref || null, remarks: remark || null },
      }));
      key.current = newKey();
      setConfirm(false);
      setDone(r);
    } catch (e) {
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Fee collection" sub="Search a student, enter the amount received and print the receipt." crumbs={[['Student Finance'], ['Fee collection']]} />
      <div className="two-col wide-side">
        <div className="stack">
          <Panel title="1 · Student">
            {error ? <LoadError error={error} /> : sid && !sum ? <SkeletonRows rows={3} cols={3} /> : sum ? (
              <div className="student-pick">
                <Avatar name={sum.student.name} size="lg" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>
                    <Link to={`/students/${sum.student.code}`} style={{ color: 'inherit' }}>{sum.student.name}</Link>
                  </div>
                  <div className="muted" style={{ fontSize: 12.5 }}>{sum.student.code} · {sum.student.mobile} · {sum.student.course.code} · {sum.student.time_slot}</div>
                  <div style={{ marginTop: 6 }}><FeeStateBadge s={sum.fee_state} /></div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setParams({})}><X /> Change</button>
              </div>
            ) : (
              <StudentSearch onPick={(code) => setParams({ student: code })} />
            )}
            {sum && (
              <>
                <div className="fee-hero" style={{ border: '1px solid var(--line)', borderRadius: 10, marginTop: 14 }}>
                  <div><span>Net fee</span><strong>{money(sum.net_fee)}</strong></div>
                  <div><span>Paid so far</span><strong style={{ color: 'var(--success-700)' }}>{money(sum.total_paid)}</strong></div>
                  <div><span>Balance</span><strong style={{ color: bal ? 'var(--danger-700)' : undefined }}>{money(bal)}</strong></div>
                  <div>
                    <span>Progress</span>
                    <div className="row" style={{ marginTop: 8 }}>
                      <Progress value={sum.paid_pct} tone="success" />
                      <span className="num muted" style={{ fontSize: 12 }}>{sum.paid_pct}%</span>
                    </div>
                  </div>
                </div>
                <div className="table-wrap" style={{ marginTop: 14 }}>
                  <table className="table">
                    <thead><tr><th>Installment</th><th>Due</th><th className="ta-r">Amount</th><th className="ta-r">Paid</th><th>Status</th></tr></thead>
                    <tbody>
                      {sum.schedule.map((r) => (
                        <tr key={r.no}>
                          <td>{r.no === 0 ? 'Admission' : `#${r.no}`}</td>
                          <td>{date(r.due_date)}</td>
                          <td className="ta-r num">{money(r.amount)}</td>
                          <td className="ta-r num">{money(r.paid)}</td>
                          <td><InstBadge s={r.state} /></td>
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
              <span className="muted" style={{ fontSize: 12 }}>{date(new Date())}</span>
            </div>
            {!sum ? (
              <Empty icon={<IndianRupee />} title="Select a student first" body="Search by name, mobile number or Student ID to load the fee summary." />
            ) : bal === 0 ? (
              <Empty icon={<CheckCircle2 />} title="Fees fully paid" body={`${sum.student.name} has no pending balance.`} action={<Link className="btn btn-secondary" to={`/students/${sum.student.code}`}>View profile</Link>} />
            ) : (
              <>
                <div className="panel__body stack" style={{ gap: 16 }}>
                  <Field label="Amount received" required error={submitted ? errors.amount : ''} htmlFor="amt">
                    <MoneyInput id="amt" xl allowPaise value={amount} onChange={setAmount} />
                    <div className="amount-chips">
                      {nd && n(nd.amount) !== bal && (
                        <button type="button" className={`chip ${amount === n(nd.amount) ? 'is-active' : ''}`} onClick={() => setAmount(n(nd.amount))}>
                          Next installment · {money(nd.amount)}
                        </button>
                      )}
                      <button type="button" className={`chip ${amount === bal ? 'is-active' : ''}`} onClick={() => setAmount(bal)}>Full balance · {money(bal)}</button>
                    </div>
                  </Field>
                  <div className="field">
                    <span className="field__label">Payment mode <span className="req">*</span></span>
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
                  <button className="btn btn-accent btn-lg btn-block" onClick={() => { setSubmitted(true); if (valid) setConfirm(true); }}>
                    <IndianRupee /> Collect {amount ? money(Number(amount)) : 'fee'}
                  </button>
                </div>
              </>
            )}
          </section>
        </aside>
      </div>

      {sum && (
        <Confirm open={confirm} onClose={() => setConfirm(false)} icon={<IndianRupee />} title={`Collect ${money(Number(amount))}?`}
          body="Please confirm the amount and student before saving. A receipt number will be issued." confirmLabel="Confirm & save" busy={busy} onConfirm={collect}>
          <div className="summary-box">
            <div className="kv"><span>Student</span><strong>{sum.student.name} · {sum.student.code}</strong></div>
            <div className="kv"><span>Mode</span><strong>{mode}{ref && ` · ${ref}`}</strong></div>
            <div className="kv"><span>Balance after</span><strong>{money(bal - Number(amount || 0))}</strong></div>
            <div className="kv total"><span>Amount</span><strong>{money(Number(amount || 0))}</strong></div>
          </div>
        </Confirm>
      )}

      {wa && (
        <WhatsAppSend open onClose={() => setWa(null)} title={`Send receipt ${wa.receipt_no}`} name={wa.snapshot.student.name} phone={wa.send_to?.whatsapp_number ?? sum?.student.whatsapp_number ?? wa.snapshot.student.mobile} recordLabel="student’s profile"
          message={receiptMessage(wa.snapshot)} pdf={() => receiptPdf(wa)}
          onOpened={() => api(`/receipts/${wa.receipt_no}/share-events`, { method: 'POST', body: { event_type: 'WHATSAPP_OPENED' } }).catch(() => {})} />
      )}

      <Modal open={!!done} onClose={() => setDone(null)}>
        {done && (
          <>
            <div className="modal__head">
              <div className="modal__icon success"><CheckCircle2 /></div>
              <div>
                <h2>Payment recorded</h2>
                <p>{money(done.payment.amount)} received from <strong>{done.payment.student.name}</strong>. Receipt <span className="id">{done.receipt.receipt_no}</span> is ready.</p>
              </div>
            </div>
            <div style={{ height: 16 }} />
            <div className="modal__foot">
              <button className="btn btn-whatsapp" onClick={() => { setWa(done.receipt); setDone(null); }}><MessageCircle /> Send on WhatsApp</button>
              <button className="btn btn-secondary" onClick={() => { setDone(null); setParams({}); }}>Collect another</button>
              <button className="btn btn-primary" onClick={() => nav(`/fees/receipts/${done.receipt.receipt_no}`)}><Printer /> Print receipt</button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

function StudentSearch({ onPick }: { onPick: (code: string) => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const dq = useDebounced(q.trim());
  useEffect(() => ref.current?.focus(), []);
  const { data } = useQuery<Page<StudentRow>>('/students', dq ? { q: dq, page_size: 8 } : { fee_status: 'Overdue', status: 'Active', page_size: 6 });
  const results = (data?.items ?? []).filter((s) => s.status !== 'Left');
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
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(results.length - 1, a + 1));
            if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
            if (e.key === 'Enter' && results[active]) onPick(results[active].code);
          }}
          aria-label="Search student"
        />
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="menu__label" style={{ padding: '6px 4px' }}>{dq ? `${results.length} matches` : 'Overdue fees'}</div>
        {data && results.length === 0 && <p className="muted" style={{ fontSize: 13, padding: '10px 4px' }}>{dq ? 'No student found. Check the spelling or try the mobile number.' : 'No overdue students.'}</p>}
        {results.map((s, i) => (
          <button key={s.code} className={`combo__item ${i === active ? 'is-active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => onPick(s.code)}>
            <Avatar name={s.full_name} size="sm" />
            <span>
              <strong style={{ fontWeight: 600, fontSize: 13.5 }}>{s.full_name}</strong>
              <br />
              <small className="muted">{s.code} · {s.mobile} · {s.course.code}</small>
            </span>
            <span className="bal">
              <strong className="num">{money(s.balance)}</strong>
              <br />
              <small className="muted">balance</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
