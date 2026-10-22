import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Ban, Check, FileDown, Lock, MessageCircle, Minus, Pencil, Plus, Printer, RotateCcw, Search, Trash2, Unlock, X } from 'lucide-react';
import logo from '../../assets/logo.png';
import { useApp } from '../../app/AppContext';
import { PayModePicker } from '../../components/PayModePicker';
import { BillStatusBadge, Confirm, Field, MoneyInput, PageHeader } from '../../components/ui';
import { cancelBill, createBill, db, payBill, touch, useStore } from '../../data/store';
import type { Bill, BillItem, PayMode } from '../../data/types';
import { amountInWords, date, dateTime, money } from '../../lib/format';
import { institute } from '../../lib/institute';
import { PAY_LABEL } from '../../lib/payModes';
import { billMessage } from '../../lib/whatsapp';
import { WhatsAppSend } from '../../components/WhatsAppSend';
import NotFound from '../NotFound';

/* UX-016 / UX-017 — Service Bill desk.
   Left: line items (add · change qty · edit · delete). Right: the bill exactly as it will print.
   Rules: rate comes from Service Master; only Admin may override it (FR-025). Fixed discount only (C-38).
   One full payment (FR-026). Paid-bill edit and cancellation are Admin-only (FR-027). */

type Line = BillItem & { key: number };
let keySeq = 1;
const toLines = (items: BillItem[]): Line[] => items.map((i) => ({ ...i, key: keySeq++ }));
const QUICK = ['S16', 'S17', 'S18', 'S19', 'S13', 'S15'];

export default function BillDesk() {
  useStore();
  const { id } = useParams();
  const [params] = useSearchParams();
  const isNew = id === 'new' || !id;
  const autoSend = params.get('send') === '1';
  const existing = !isNew ? db.bills.find((b) => b.id === id) : undefined;
  if (!isNew && !existing) return <NotFound what="bill" />;
  return <Desk key={existing?.id ?? 'new'} bill={existing} initialJob={params.get('job') ?? ''} autoSend={autoSend} />;
}

function Desk({ bill, initialJob, autoSend }: { bill?: Bill; initialJob: string; autoSend?: boolean }) {
  const { can, role, user, toast } = useApp();
  const nav = useNavigate();
  const isAdmin = role === 'Admin';
  const canRate = can('service_bill.rate_override');

  const billableJobs = db.jobs.filter((j) => !j.billId && j.status !== 'Cancelled');
  const [jobId, setJobId] = useState(bill?.jobId ?? (billableJobs.some((j) => j.id === initialJob) ? initialJob : ''));
  const job = jobId ? db.jobById(jobId) : undefined;
  const customer = job ? db.customerById(job.customerId) : bill ? db.customerById(bill.customerId) : undefined;

  const [lines, setLines] = useState<Line[]>(() => toLines(bill ? bill.items : job ? job.serviceIds.map((s) => ({ serviceId: s, qty: 1, rate: db.serviceById(s).price })) : []));
  const [discount, setDiscount] = useState<number | ''>(bill?.discount ?? 0);
  const [unlocked, setUnlocked] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<BillItem | null>(null);
  const [removed, setRemoved] = useState<{ line: Line; index: number } | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [mode, setMode] = useState<PayMode>('Cash');
  const [payOpen, setPayOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmNo, setConfirmNo] = useState('');
  const [editReason, setEditReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [wa, setWa] = useState(!!autoSend && bill?.status === 'Paid');

  // when a job is picked for a new bill, load its services as the starting lines
  useEffect(() => {
    if (!bill && job) setLines(toLines(job.serviceIds.map((s) => ({ serviceId: s, qty: 1, rate: db.serviceById(s).price }))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  useEffect(() => {
    if (!removed) return;
    const t = setTimeout(() => setRemoved(null), 7000);
    return () => clearTimeout(t);
  }, [removed]);

  const status = bill?.status ?? 'Draft';
  const editable = !bill || bill.status === 'Unpaid' || (bill.status === 'Paid' && unlocked);
  const sub = lines.reduce((t, l) => t + l.qty * l.rate, 0);
  const disc = Math.min(Number(discount || 0), sub);
  const total = Math.max(0, sub - disc);
  const dirty = bill ? JSON.stringify(lines.map(({ key, ...i }) => i)) !== JSON.stringify(bill.items) || disc !== bill.discount : lines.length > 0;
  const discountError = Number(discount || 0) > sub ? 'Discount can’t be more than the subtotal' : '';

  /* ---------------- item operations ---------------- */
  const addItem = (serviceId: string, qty = 1) => {
    const existingIdx = lines.findIndex((l) => l.serviceId === serviceId && l.rate === db.serviceById(serviceId).price);
    if (existingIdx >= 0) {
      const k = lines[existingIdx].key;
      setLines((ls) => ls.map((l, i) => (i === existingIdx ? { ...l, qty: l.qty + qty } : l)));
      setFlash(k);
    } else {
      const line = { serviceId, qty, rate: db.serviceById(serviceId).price, key: keySeq++ };
      setLines((ls) => [...ls, line]);
      setFlash(line.key);
    }
    setTimeout(() => setFlash(null), 900);
  };
  const setQty = (key: number, qty: number) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, qty: Math.max(1, Math.min(999, qty)) } : l)));
  const remove = (key: number) => {
    const index = lines.findIndex((l) => l.key === key);
    setRemoved({ line: lines[index], index });
    setLines((ls) => ls.filter((l) => l.key !== key));
    if (editing === key) setEditing(null);
  };
  const undo = () => {
    if (!removed) return;
    setLines((ls) => [...ls.slice(0, removed.index), removed.line, ...ls.slice(removed.index)]);
    setRemoved(null);
  };
  const startEdit = (l: Line) => {
    setEditing(l.key);
    setDraft({ serviceId: l.serviceId, qty: l.qty, rate: l.rate });
  };
  const saveEdit = () => {
    if (!draft || editing === null) return;
    setLines((ls) => ls.map((l) => (l.key === editing ? { ...l, ...draft, qty: Math.max(1, draft.qty) } : l)));
    setFlash(editing);
    setTimeout(() => setFlash(null), 900);
    setEditing(null);
  };

  /* ---------------- persistence ---------------- */
  const persist = (): Bill | undefined => {
    const items = lines.map(({ key, ...i }) => i);
    if (!bill) {
      if (!job) return undefined;
      return createBill(job.id, items, disc, user.id);
    }
    const before = { total: money(db.billTotal(bill)), items: String(bill.items.length) };
    bill.items = items;
    bill.discount = disc;
    db.audit.unshift({
      id: `B${Date.now()}`, at: new Date(), actor: user.id, action: bill.status === 'Paid' ? 'PAID_BILL_EDITED' : 'BILL_UPDATED', entity: 'Service Bill', entityId: bill.id,
      summary: bill.status === 'Paid' ? `Paid bill edited — ${editReason.trim()}` : `Bill ${bill.id} updated`, ip: '192.168.1.11', before, after: { total: money(total), items: String(items.length) },
    });
    touch();
    return bill;
  };

  const saveOnly = () => {
    if (!lines.length || discountError) return;
    if (bill?.status === 'Paid' && editReason.trim().length < 5) {
      toast('error', 'Reason required', 'Enter why this paid bill is being changed.');
      return;
    }
    const b = persist();
    if (!b) return;
    setUnlocked(false);
    setEditReason('');
    toast('success', bill ? 'Bill updated' : `Bill ${b.id} created`, `${lines.length} item${lines.length > 1 ? 's' : ''} · ${money(total)}`);
    if (!bill) nav(`/services/bills/${b.id}`, { replace: true });
  };

  const shownNo = bill?.id ?? `SB-${db.TODAY.getFullYear()}-${String(db.bills.reduce((m, b) => Math.max(m, parseInt(b.id.split('-')[2], 10)), 300) + 1).padStart(4, '0')}`;

  return (
    <>
      <PageHeader
        title={
          <span className="row" style={{ gap: 10 }}>
            {bill ? `Bill ${bill.id}` : 'New service bill'}
            {bill ? <BillStatusBadge s={bill.status} /> : <span className="badge badge--neutral">Draft</span>}
          </span>
        }
        sub={
          customer ? (
            <>
              {customer.name} · {customer.mobile}
              {job && (
                <>
                  {' · Job '}
                  <Link to={`/services/jobs/${job.id}`}>{job.id}</Link>
                </>
              )}
            </>
          ) : (
            'Pick the service job this bill is for.'
          )
        }
        crumbs={[['Services'], ['Service bills', '/services/bills'], [bill ? bill.id : 'New bill']]}
        actions={
          <>
            {bill && bill.status !== 'Cancelled' && can('service_bill.cancel') && (
              <button className="btn btn-danger-soft" onClick={() => setCancelOpen(true)}>
                <Ban /> Cancel bill
              </button>
            )}
            {bill && bill.status !== 'Cancelled' && customer && (
              <button className="btn btn-whatsapp" onClick={() => setWa(true)}>
                <MessageCircle /> Send bill on WhatsApp
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => window.print()} disabled={!lines.length}>
              <Printer /> Print
            </button>
          </>
        }
      />

      <div className="billdesk">
        {/* ---------------------------- Items editor ---------------------------- */}
        <section className="panel billdesk__items no-print">
          <div className="panel__head">
            <div>
              <h2>Items</h2>
              <p>{editable ? 'Rates come from Service Master' + (canRate ? ' — you can override as Admin.' : '.') : 'Locked — this bill is ' + status.toLowerCase() + '.'}</p>
            </div>
            {bill?.status === 'Paid' && isAdmin && !unlocked && (
              <button className="btn btn-secondary btn-sm" onClick={() => setUnlocked(true)}>
                <Unlock /> Edit paid bill
              </button>
            )}
          </div>

          {!bill && (
            <div className="billdesk__job">
              <Field label="Service job" required htmlFor="bjob" hint={billableJobs.length ? undefined : 'Every open job already has a bill.'}>
                <select id="bjob" className="select" value={jobId} onChange={(e) => setJobId(e.target.value)}>
                  <option value="">Select a job without a bill…</option>
                  {billableJobs
                    .slice()
                    .reverse()
                    .map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.id} · {db.customerById(j.customerId).name} · {db.serviceById(j.serviceIds[0]).name} ({j.status})
                      </option>
                    ))}
                </select>
              </Field>
            </div>
          )}

          {bill?.status === 'Paid' && unlocked && (
            <div className="billdesk__warn">
              <Lock size={15} />
              <div>
                <strong>Editing a paid bill.</strong> {money(db.billTotal(bill))} was already received. The old and new values go to the audit log.
                <input className="input" style={{ marginTop: 8 }} placeholder="Reason for change (required)" value={editReason} onChange={(e) => setEditReason(e.target.value)} />
              </div>
            </div>
          )}

          {editable && (job || bill) && <AddBar onAdd={addItem} />}

          <div className="lines" role="table" aria-label="Bill items">
            <div className="lines__head" role="row">
              <span>Service</span>
              <span className="ta-c">Qty</span>
              <span className="ta-r">Rate</span>
              <span className="ta-r">Amount</span>
              <span />
            </div>
            {lines.length === 0 && (
              <div className="lines__empty">
                {job || bill ? 'No items yet. Search above or use a shortcut to add the first one.' : 'Select a job to start.'}
              </div>
            )}
            {lines.map((l, i) => {
              const sv = db.serviceById(l.serviceId);
              const overridden = l.rate !== sv.price;
              if (editing === l.key && draft) {
                return (
                  <div className="line is-editing" key={l.key} role="row">
                    <div className="line__edit">
                      <select className="select" value={draft.serviceId} onChange={(e) => setDraft({ ...draft, serviceId: e.target.value, rate: canRate ? draft.rate : db.serviceById(e.target.value).price })} aria-label="Service">
                        {db.serviceCategories.map((c) => (
                          <optgroup key={c.id} label={c.name}>
                            {db.services.filter((s) => s.categoryId === c.id && (s.active || s.id === draft.serviceId)).map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} — {money(s.price)}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <div className="line__edit-row">
                        <label>
                          Qty
                          <input className="input num" inputMode="numeric" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: Number(e.target.value.replace(/\D/g, '')) || 0 })} onKeyDown={(e) => e.key === 'Enter' && saveEdit()} autoFocus />
                        </label>
                        <label>
                          Rate {!canRate && <Lock size={11} />}
                          {canRate ? <MoneyInput value={draft.rate} onChange={(v) => setDraft({ ...draft, rate: Number(v || 0) })} /> : <input className="input num" value={money(draft.rate)} readOnly />}
                        </label>
                        <span className="line__edit-amt num">{money(Math.max(1, draft.qty) * draft.rate)}</span>
                      </div>
                      {canRate && draft.rate !== db.serviceById(draft.serviceId).price && (
                        <span className="line__note">
                          Overriding master rate {money(db.serviceById(draft.serviceId).price)} — will be audited.{' '}
                          <button type="button" className="linkish" onClick={() => setDraft({ ...draft, rate: db.serviceById(draft.serviceId).price })}>
                            Reset
                          </button>
                        </span>
                      )}
                    </div>
                    <div className="line__actions">
                      <button className="icon-btn sm ok" onClick={saveEdit} aria-label="Save line">
                        <Check />
                      </button>
                      <button className="icon-btn sm" onClick={() => setEditing(null)} aria-label="Cancel edit">
                        <X />
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <div className={`line ${flash === l.key ? 'is-flash' : ''}`} key={l.key} role="row">
                  <div className="line__name">
                    <span className="line__no">{i + 1}</span>
                    <div>
                      <strong>{sv.name}</strong>
                      <small>
                        {db.serviceCategories.find((c) => c.id === sv.categoryId)?.name}
                        {overridden && <em> · master {money(sv.price)}</em>}
                      </small>
                    </div>
                  </div>
                  <div className="ta-c">
                    {editable ? (
                      <span className="stepper-qty">
                        <button onClick={() => (l.qty === 1 ? remove(l.key) : setQty(l.key, l.qty - 1))} aria-label={l.qty === 1 ? 'Remove item' : 'Decrease quantity'}>
                          <Minus />
                        </button>
                        <input className="num" inputMode="numeric" value={l.qty} onChange={(e) => setQty(l.key, Number(e.target.value.replace(/\D/g, '')) || 1)} aria-label="Quantity" />
                        <button onClick={() => setQty(l.key, l.qty + 1)} aria-label="Increase quantity">
                          <Plus />
                        </button>
                      </span>
                    ) : (
                      <span className="num">{l.qty}</span>
                    )}
                  </div>
                  <div className="ta-r num">
                    {money(l.rate)}
                    {overridden && <span className="override-tag">override</span>}
                  </div>
                  <div className="ta-r num line__amt">{money(l.qty * l.rate)}</div>
                  <div className="line__actions">
                    {editable && (
                      <>
                        <button className="icon-btn sm" onClick={() => startEdit(l)} aria-label={`Edit ${sv.name}`} data-tip="Edit">
                          <Pencil />
                        </button>
                        <button className="icon-btn sm danger" onClick={() => remove(l.key)} aria-label={`Delete ${sv.name}`} data-tip="Delete">
                          <Trash2 />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {removed && (
            <div className="undo-bar" role="status">
              <span>
                Removed <strong>{db.serviceById(removed.line.serviceId).name}</strong>
              </span>
              <button className="btn btn-ghost btn-sm" onClick={undo}>
                <RotateCcw /> Undo
              </button>
            </div>
          )}

          <div className="billdesk__totals">
            <div className="row-between">
              <span className="muted">Subtotal · {lines.reduce((t, l) => t + l.qty, 0)} units</span>
              <span className="num">{money(sub)}</span>
            </div>
            <div className="row-between" style={{ alignItems: 'flex-start' }}>
              <label htmlFor="disc" className="muted" style={{ paddingTop: 8 }}>
                Discount (fixed ₹)
              </label>
              <div style={{ width: 150, textAlign: 'right', paddingTop: editable ? 0 : 8 }}>
                {editable ? <MoneyInput id="disc" value={discount} onChange={setDiscount} /> : <span className="num">− {money(disc)}</span>}
                {discountError && <span className="field__error" style={{ marginTop: 4 }}>{discountError}</span>}
              </div>
            </div>
            <div className="row-between grand">
              <span>Grand total</span>
              <span className="num">{money(total)}</span>
            </div>
          </div>

          {editable && (
            <div className="billdesk__pay">
              {(!bill || bill.status === 'Unpaid') && !unlocked ? (
                <>
                  <div className="field">
                    <span className="field__label">Payment mode · full amount only</span>
                    <PayModePicker value={mode} onChange={setMode} />
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn btn-secondary" disabled={!dirty || !lines.length || !!discountError || (!bill && !job)} onClick={saveOnly}>
                      {bill ? 'Save changes' : 'Save as unpaid'}
                    </button>
                    <button className="btn btn-accent btn-lg" style={{ flex: 1 }} disabled={!lines.length || total <= 0 || !!discountError || (!bill && !job)} onClick={() => setPayOpen(true)}>
                      Receive {money(total)}
                    </button>
                  </div>
                </>
              ) : (
                <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      setUnlocked(false);
                      setLines(toLines(bill!.items));
                      setDiscount(bill!.discount);
                    }}
                  >
                    Discard changes
                  </button>
                  <button className="btn btn-primary" disabled={!dirty || !lines.length || !!discountError} onClick={saveOnly}>
                    Save paid bill
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ---------------------------- Live bill ---------------------------- */}
        <section className="billdesk__preview">
          <div className="billdesk__preview-head no-print">
            <span>Bill preview · A4</span>
            <span className="muted">{editable ? 'updates as you edit' : status}</span>
          </div>
          <article className="paper paper--bill">
            <div className="paper__band" />
            <div className="paper__head">
              <img src={logo} alt={institute.name} />
              <div className="paper__inst">
                <strong>{institute.name}</strong>
                {institute.tagline}
                <br />
                {institute.address}
                <br />
                {institute.phone}
              </div>
            </div>
            <div className="paper__title">
              <h2>Service Bill</h2>
              <div style={{ textAlign: 'right', fontSize: 12.5 }}>
                <div className="no">No. {shownNo}</div>
                <div style={{ color: '#7a8699' }}>{date(bill?.createdAt ?? new Date())}</div>
              </div>
            </div>
            {bill?.status === 'Paid' && !unlocked && <div className="stamp">PAID</div>}
            {bill?.status === 'Cancelled' && <div className="stamp cancelled">CANCELLED</div>}
            <div className="paper__body">
              <div className="paper__grid">
                <div>
                  <span>Customer</span>
                  <strong>{customer?.name ?? '—'}</strong>
                </div>
                <div>
                  <span>Customer ID</span>
                  <strong>{customer?.id ?? '—'}</strong>
                </div>
                <div>
                  <span>Mobile</span>
                  <strong>{customer?.mobile ?? '—'}</strong>
                </div>
                <div>
                  <span>Job ref.</span>
                  <strong>{job?.id ?? bill?.jobId ?? '—'}</strong>
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>#</th>
                    <th>Particulars</th>
                    <th className="ta-r" style={{ width: 50 }}>Qty</th>
                    <th className="ta-r" style={{ width: 90 }}>Rate</th>
                    <th className="ta-r" style={{ width: 100 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.key} className={flash === l.key ? 'is-flash' : ''}>
                      <td>{i + 1}</td>
                      <td>{db.serviceById(l.serviceId).name}</td>
                      <td className="ta-r num">{l.qty}</td>
                      <td className="ta-r num">{money(l.rate)}</td>
                      <td className="ta-r num">{money(l.qty * l.rate)}</td>
                    </tr>
                  ))}
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ color: '#9aa4b2', textAlign: 'center', padding: '28px 8px' }}>
                        Items you add appear here
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="paper__totals">
                <div>
                  <span>Subtotal</span>
                  <span className="num">{money(sub)}</span>
                </div>
                {disc > 0 && (
                  <div>
                    <span>Discount</span>
                    <span className="num">− {money(disc)}</span>
                  </div>
                )}
                <div className="grand">
                  <span>Grand total</span>
                  <span className="num">{money(total)}</span>
                </div>
                <div style={{ fontSize: 11.5, color: '#7a8699', fontStyle: 'italic', justifyContent: 'flex-end', textAlign: 'right' }}>{amountInWords(total)}</div>
              </div>
              {bill?.status === 'Paid' && bill.paidAt && (
                <p style={{ fontSize: 12.5, color: '#4a5568', marginTop: 10 }}>
                  Paid in full by <strong>{PAY_LABEL[bill.mode!]}</strong> on {dateTime(bill.paidAt)}.
                </p>
              )}
            </div>
            <div className="paper__foot">
              <div style={{ maxWidth: 560 }}>{institute.billFooter}<br />{institute.billAccountNote}</div>
            </div>
          </article>
          {bill?.status === 'Paid' && (
            <button className="btn btn-ghost btn-sm no-print" style={{ marginTop: 10 }} onClick={() => window.print()}>
              <FileDown /> Save as PDF
            </button>
          )}
        </section>
      </div>

      {bill && customer && (
        <WhatsAppSend
          open={wa}
          onClose={() => setWa(false)}
          title={`Send bill ${bill.id}`}
          name={customer.name}
          phone={customer.whatsapp}
          message={billMessage({
            name: customer.name, billNo: bill.id, jobId: bill.jobId, at: bill.createdAt, discount: bill.discount, total: db.billTotal(bill), paid: bill.status === 'Paid', mode: bill.mode ? PAY_LABEL[bill.mode] : undefined,
            items: bill.items.map((i) => ({ name: db.serviceById(i.serviceId).name, qty: i.qty, rate: i.rate })),
          })}
          onPdf={() => window.print()}
          onOpened={() => {
            db.audit.unshift({ id: `W${Date.now()}`, at: new Date(), actor: user.id, action: 'BILL_SHARED', entity: 'Service Bill', entityId: bill.id, summary: `Bill ${bill.id} opened in WhatsApp for ${customer.name}`, ip: '192.168.1.11' });
            touch();
            toast('success', 'WhatsApp opened', `Bill ready to send to ${customer.name}`);
          }}
        />
      )}

      <Confirm
        open={payOpen}
        onClose={() => setPayOpen(false)}
        icon={<Check />}
        title={`Receive ${money(total)} from ${customer?.name}?`}
        body={`Full payment by ${PAY_LABEL[mode]}. The bill is locked once paid.`}
        confirmLabel="Confirm payment"
        busy={busy}
        onConfirm={() => {
          setBusy(true);
          setTimeout(() => {
            const b = dirty || !bill ? persist() : bill;
            if (b) {
              payBill(b.id, mode, user.id);
              toast('success', 'Payment received', `${b.id} · ${money(total)} · ${PAY_LABEL[mode]}`);
              if (!bill) nav(`/services/bills/${b.id}?send=1`, { replace: true });
              else setWa(true);
            }
            setBusy(false);
            setPayOpen(false);
          }, 600);
        }}
      >
        <div className="summary-box">
          <div className="kv">
            <span>Items</span>
            <strong>{lines.length}</strong>
          </div>
          <div className="kv">
            <span>Mode</span>
            <strong>{PAY_LABEL[mode]}</strong>
          </div>
          <div className="kv total">
            <span>Amount</span>
            <strong>{money(total)}</strong>
          </div>
        </div>
      </Confirm>

      {bill && (
        <Confirm
          open={cancelOpen}
          onClose={() => setCancelOpen(false)}
          tone="danger"
          icon={<Ban />}
          title={`Cancel bill ${bill.id}?`}
          body={`${money(db.billTotal(bill))} for ${customer?.name} will be excluded from revenue and reports. The bill stays in history.${bill.status === 'Paid' ? ' Refund handling for paid bills is still to be agreed (GAP-003).' : ''}`}
          confirmLabel="Cancel bill"
          disabled={reason.trim().length < 5 || confirmNo.trim().toUpperCase() !== bill.id.toUpperCase()}
          onConfirm={() => {
            cancelBill(bill.id, reason.trim(), user.id);
            setCancelOpen(false);
            toast('success', 'Bill cancelled', bill.id);
          }}
        >
          <div className="stack" style={{ gap: 14 }}>
            <Field label="Reason" required htmlFor="cr" hint="Recorded in the audit log">
              <textarea id="cr" className="textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Field label={`Type ${bill.id} to confirm`} required htmlFor="cno">
              <input id="cno" className="input id" value={confirmNo} onChange={(e) => setConfirmNo(e.target.value)} autoComplete="off" />
            </Field>
          </div>
        </Confirm>
      )}
    </>
  );
}

/* Search-to-add bar: type, arrow to choose, Enter adds. Quantity can be set first. */
function AddBar({ onAdd }: { onAdd: (serviceId: string, qty: number) => void }) {
  const [q, setQ] = useState('');
  const [qty, setQty] = useState(1);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = db.services.filter((x) => x.active);
    return (s ? list.filter((x) => x.name.toLowerCase().includes(s) || db.serviceCategories.find((c) => c.id === x.categoryId)!.name.toLowerCase().includes(s)) : list).slice(0, 8);
  }, [q]);
  const add = (sid: string) => {
    onAdd(sid, Math.max(1, qty));
    setQ('');
    setQty(1);
    setOpen(false);
    inputRef.current?.focus();
  };
  return (
    <div className="addbar">
      <div className="addbar__row">
        <div className="input-group combo" style={{ flex: 1 }}>
          <Search />
          <input
            ref={inputRef}
            className="input"
            placeholder="Add a service — type to search, Enter to add"
            value={q}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter' && results[active]) {
                e.preventDefault();
                add(results[active].id);
              } else if (e.key === 'Escape') setOpen(false);
            }}
            aria-label="Search service to add"
          />
          {open && results.length > 0 && (
            <div className="combo__list">
              {results.map((s, i) => (
                <button key={s.id} type="button" className={`combo__item ${i === active ? 'is-active' : ''}`} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => add(s.id)}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontWeight: 500, fontSize: 13.5 }}>{s.name}</strong>
                    <br />
                    <small className="muted">{db.serviceCategories.find((c) => c.id === s.categoryId)?.name}</small>
                  </span>
                  <span className="num" style={{ fontSize: 13 }}>{money(s.price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <label className="addbar__qty">
          <span>Qty</span>
          <input className="input num" inputMode="numeric" value={qty} onChange={(e) => setQty(Number(e.target.value.replace(/\D/g, '')) || 1)} aria-label="Quantity to add" />
        </label>
        <button className="btn btn-primary" disabled={!results[active] || !q.trim()} onClick={() => results[active] && add(results[active].id)}>
          <Plus /> Add
        </button>
      </div>
      <div className="addbar__quick">
        <span>Counter items:</span>
        {QUICK.map((sid) => {
          const s = db.serviceById(sid);
          return (
            <button key={sid} type="button" className="quick-chip" onClick={() => onAdd(sid, 1)} title={`Add 1 × ${s.name}`}>
              + {s.name.replace(' (per page)', '')} <span className="num">{money(s.price)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
