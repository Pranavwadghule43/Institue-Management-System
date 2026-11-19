import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Ban, Check, FileDown, Lock, MessageCircle, Minus, Pencil, Plus, Printer, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { errText, useApp } from '../../app/AppContext';
import { PayModePicker } from '../../components/PayModePicker';
import { BillStatusBadge, Confirm, Field, LoadError, MoneyInput, PageHeader, SkeletonRows } from '../../components/ui';
import { api, newKey, useQuery, write, type Page } from '../../api/client';
import type { Bill, Job, PayMode, Service, Settings } from '../../api/types';
import { money, n } from '../../lib/format';
import { PAY_LABEL } from '../../lib/payModes';
import { billMessage } from '../../lib/whatsapp';
import { WhatsAppSend } from '../../components/WhatsAppSend';
import { PrintArea, ServiceBillPrint, billPdf, billPrintData, type BillPrintData, type ServiceLoginDetails } from '../../components/PrintDocs';
import { saveFile } from '../../lib/pdf';
import NotFound from '../NotFound';

/* UX-016 / UX-017 — Service Bill desk.
   Left: line items (add · change qty · edit · delete). Right: the bill exactly as it prints (paper template).
   The server recalculates every total; rates come from Service Master and only the Admin may override them.
   Paid bills are locked: a correction is an Admin cancellation followed by a replacement bill. */

interface Line { key: number; serviceId: number; name: string; qty: number; rate: number }
let keySeq = 1;

export default function BillDesk() {
  const { id } = useParams();
  const [params] = useSearchParams();
  // This ref lives only in the bill desk. The password crosses the save-to-detail
  // navigation once, without going into browser history or persistent storage.
  const handoff = useRef<{ code: string; password: string } | null>(null);
  const takePassword = useCallback((code: string) => {
    const pending = handoff.current;
    handoff.current = null;
    return pending?.code === code ? pending.password : '';
  }, []);
  const isNew = id === 'new' || !id;
  const { data: bill, error } = useQuery<Bill>(isNew ? null : `/service-bills/${id}`);
  if (error?.status === 404) return <NotFound what="bill" />;
  if (error) return <LoadError error={error} />;
  if (!isNew && !bill) return <SkeletonRows rows={6} cols={4} />;
  const initialJob = params.get('job') ?? '';
  return <Desk key={bill?.code ?? `new:${initialJob}`} bill={bill} initialJob={initialJob} autoSend={params.get('send') === '1'}
    takePassword={takePassword} carryPassword={(code, password) => { handoff.current = { code, password }; }} />;
}

function Desk({ bill, initialJob, autoSend, takePassword, carryPassword }: {
  bill?: Bill; initialJob: string; autoSend?: boolean;
  takePassword: (code: string) => string; carryPassword: (code: string, password: string) => void;
}) {
  const { can, role, toast } = useApp();
  const nav = useNavigate();
  const canRate = can('service_bill.rate_override');
  const { data: services } = useQuery<Service[]>('/services', { active: true });
  const { data: settings } = useQuery<Settings>('/settings');
  const { data: billable } = useQuery<Page<Job>>(bill ? null : '/service-jobs', { billable: true, page_size: 100 });
  const [jobCode, setJobCode] = useState(bill?.job.code ?? initialJob);
  const job = billable?.items.find((j) => j.code === jobCode);
  const price = (sid: number) => n(services?.find((s) => s.id === sid)?.price);

  const fromBill = () => (bill ? bill.items.map((i) => ({ key: keySeq++, serviceId: i.service_id ?? 0, name: i.name, qty: i.quantity, rate: n(i.rate) })) : []);
  const [lines, setLines] = useState<Line[]>(fromBill);
  const [discount, setDiscount] = useState<number | ''>(bill ? n(bill.discount) : 0);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ serviceId: number; qty: number; rate: number } | null>(null);
  const [removed, setRemoved] = useState<{ line: Line; index: number } | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [mode, setMode] = useState<PayMode>('Cash');
  const [reference, setReference] = useState('');
  const [draftUsername, setDraftUsername] = useState<string>();
  const [servicePassword, setServicePassword] = useState('');
  const [includeLogin, setIncludeLogin] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmNo, setConfirmNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [shareBill, setShareBill] = useState<Bill | null>(autoSend && bill?.status === 'Paid' ? bill : null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const payKey = useRef(newKey());
  const code = bill?.code;
  useEffect(() => {
    if (!code) return;
    const carried = takePassword(code);
    if (carried) setServicePassword(carried);
  }, [code, takePassword]);

  // when a job is picked for a new bill, start from its services at current Service Master rates
  useEffect(() => {
    if (!bill && job && services) setLines(job.services.map((s) => ({ key: keySeq++, serviceId: s.id, name: s.name, qty: s.quantity, rate: price(s.id) || n(s.rate) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobCode, !!services, !!job]);

  useEffect(() => {
    if (!removed) return;
    const t = setTimeout(() => setRemoved(null), 7000);
    return () => clearTimeout(t);
  }, [removed]);

  const status = bill?.status ?? 'Draft';
  const editable = !bill || bill.status === 'Unpaid';
  const sub = lines.reduce((t, l) => t + l.qty * l.rate, 0);
  const disc = Math.min(Number(discount || 0), sub);
  const total = Math.max(0, sub - disc);
  const serviceUsername = draftUsername ?? bill?.service_login_username ?? '';
  const username = serviceUsername.trim();
  const usernameDirty = username !== (bill?.service_login_username ?? '');
  const dirty = bill ? usernameDirty || JSON.stringify(lines.map((l) => [l.serviceId, l.qty, l.rate])) !== JSON.stringify(bill.items.map((i) => [i.service_id, i.quantity, n(i.rate)])) || disc !== n(bill.discount) : lines.length > 0;
  const discountError = Number(discount || 0) > sub ? 'Discount can’t be more than the subtotal' : '';

  /* ---------------- item operations ---------------- */
  const addItem = (s: Service, qty = 1) => {
    const existingIdx = lines.findIndex((l) => l.serviceId === s.id && l.rate === n(s.price));
    if (existingIdx >= 0) {
      setLines((ls) => ls.map((l, i) => (i === existingIdx ? { ...l, qty: Math.min(999, l.qty + qty) } : l)));
      setFlash(lines[existingIdx].key);
    } else {
      const line = { key: keySeq++, serviceId: s.id, name: s.name, qty, rate: n(s.price) };
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
  const saveEdit = () => {
    if (!draft || editing === null) return;
    const name = services?.find((s) => s.id === draft.serviceId)?.name ?? lines.find((l) => l.key === editing)?.name ?? '';
    setLines((ls) => ls.map((l) => (l.key === editing ? { ...l, serviceId: draft.serviceId, name, qty: Math.max(1, draft.qty), rate: draft.rate } : l)));
    setFlash(editing);
    setTimeout(() => setFlash(null), 900);
    setEditing(null);
  };

  /* ---------------- persistence (server calculates totals) ---------------- */
  const body = () => ({
    items: lines.map((l) => ({ service_id: l.serviceId, quantity: l.qty, rate: l.rate.toFixed(2) })),
    discount: disc.toFixed(2),
    ...(usernameDirty ? { service_login_username: username || null } : {}),
  });
  const openSavedBill = (b: Bill, auto = false) => {
    if (servicePassword) carryPassword(b.code, servicePassword);
    nav(`/services/bills/${b.code}${auto ? '?send=1' : ''}`, { replace: true });
  };
  const persist = async (): Promise<Bill> => {
    if (!bill) return write(api<Bill>('/service-bills', { method: 'POST', body: { job_code: jobCode, ...body() } }));
    return write(api<Bill>(`/service-bills/${bill.code}`, { method: 'PATCH', body: body() }));
  };
  const saveOnly = async () => {
    if (!lines.length || discountError) return;
    setBusy(true);
    try {
      const b = await persist();
      toast('success', bill ? 'Bill updated' : `Bill ${b.code} created`, `${lines.length} item${lines.length > 1 ? 's' : ''} · ${money(b.grand_total)}`);
      if (!bill) openSavedBill(b);
    } catch (e) {
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };
  const pay = async () => {
    let created: Bill | undefined;
    setBusy(true);
    try {
      const b = dirty || !bill ? await persist() : bill;
      if (!bill) created = b;
      const paid = await write(api<Bill>(`/service-bills/${b.code}/pay`, { method: 'POST', idempotencyKey: payKey.current, body: { payment_mode: mode, reference: reference || null } }));
      payKey.current = newKey();
      toast('success', 'Payment received', `${paid.code} · ${money(paid.grand_total)} · ${PAY_LABEL[mode]}`);
      setPayOpen(false);
      if (!bill) openSavedBill(paid, true);
      else setShareBill(paid);
    } catch (e) {
      toast('error', errText(e));
      if (created) openSavedBill(created);
    } finally {
      setBusy(false);
    }
  };

  const customer = bill?.customer ?? job?.customer;
  const inst = bill?.institute ?? settings?.institute ?? null;
  const work = (bill ? bill.job.application_name : job?.application_name) || lines.map((l) => l.name).join(', ');
  const print = useMemo<BillPrintData>(() => ({
    billNo: bill?.code ?? 'New (number on save)', date: bill?.created_at ?? new Date().toISOString(), customerName: customer?.name ?? '', mobile: customer?.mobile ?? '',
    work, serviceLogin: includeLogin && (username || servicePassword) ? { username, password: servicePassword } : undefined,
    items: lines.map((l) => ({ name: l.name, qty: l.qty, rate: l.rate, amount: l.qty * l.rate })),
    subtotal: sub, discount: disc, total, inst: inst ?? { name: null, tagline: null, address: null, phone: null },
    status: bill?.status === 'Paid' ? 'paid' : bill?.status === 'Cancelled' ? 'cancelled' : null,
    paidNote: bill?.payment && bill.paid_at ? `Paid in full by ${bill.payment.mode_label}.` : undefined,
  }), [bill, customer, work, includeLogin, username, servicePassword, lines, sub, disc, total, inst]);

  const sharePrint = useMemo(() => shareBill ? billPrintData(shareBill) : null, [shareBill]);
  const shareLogin = useMemo<ServiceLoginDetails | undefined>(() => (
    shareBill && (shareBill.service_login_username || servicePassword)
      ? { username: shareBill.service_login_username, password: servicePassword }
      : undefined
  ), [shareBill, servicePassword]);

  return (
    <>
      <PageHeader
        title={<span className="row" style={{ gap: 10 }}>{bill ? `Bill ${bill.code}` : 'New service bill'}{bill ? <BillStatusBadge s={bill.status} /> : <span className="badge badge--neutral">Draft</span>}</span>}
        sub={customer ? <>{customer.name} · {customer.mobile} · Job <Link to={`/services/jobs/${bill?.job.code ?? jobCode}`}>{bill?.job.code ?? jobCode}</Link></> : 'Pick the service job this bill is for.'}
        crumbs={[['Services'], ['Service bills', '/services/bills'], [bill ? bill.code : 'New bill']]}
        actions={
          <>
            {bill && bill.status !== 'Cancelled' && can('service_bill.cancel') && <button className="btn btn-danger-soft" onClick={() => { setReason(''); setConfirmNo(''); setCancelOpen(true); }}><Ban /> Cancel bill</button>}
            {bill && bill.status !== 'Cancelled' && <button className="btn btn-whatsapp" disabled={usernameDirty || busy} onClick={() => setShareBill(bill)}><MessageCircle /> Send bill on WhatsApp</button>}
            <button className="btn btn-secondary" disabled={!lines.length || pdfBusy} onClick={async () => { setPdfBusy(true); try { saveFile(await billPdf(print)); } catch (e) { toast('error', 'PDF could not be created', errText(e)); } finally { setPdfBusy(false); } }}>
              {pdfBusy ? <span className="spinner" /> : <FileDown />} Download PDF
            </button>
            <button className="btn btn-secondary" onClick={() => window.print()} disabled={!lines.length}><Printer /> Print</button>
          </>
        }
      />

      <div className="billdesk">
        <section className="panel billdesk__items no-print">
          <div className="panel__head">
            <div>
              <h2>Items</h2>
              <p>{editable ? 'Rates come from Service Master' + (canRate ? ' — you can override as Admin.' : '.') : `Locked — this bill is ${status.toLowerCase()}.`}</p>
            </div>
          </div>

          {!bill && (
            <div className="billdesk__job">
              <Field label="Service job" required htmlFor="bjob" hint={billable && !billable.items.length ? 'Every open job already has a bill.' : undefined}>
                <select id="bjob" className="select" value={jobCode} onChange={(e) => {
                  setJobCode(e.target.value);
                  setDraftUsername(undefined);
                  setServicePassword('');
                  setIncludeLogin(false);
                }}>
                  <option value="">Select a job without a bill…</option>
                  {billable?.items.map((j) => <option key={j.code} value={j.code}>{j.code} · {j.customer.name} · {j.services[0]?.name} ({j.status})</option>)}
                </select>
              </Field>
            </div>
          )}

          {bill?.status === 'Paid' && (
            <div className="billdesk__warn">
              <Lock size={15} />
              <div><strong>Paid bills are locked.</strong> To correct one, {role === 'Admin' ? 'cancel it with a reason and create a replacement bill.' : 'ask the Admin to cancel it and issue a replacement.'}</div>
            </div>
          )}
          {bill?.status === 'Cancelled' && (
            <div className="billdesk__warn">
              <Ban size={15} />
              <div><strong>Cancelled</strong>{bill.cancelled_by && ` by ${bill.cancelled_by.name}`} — {bill.cancellation_reason}. {can('service_bill.create') && <Link to={`/services/bills/new?job=${bill.job.code}`}>Create replacement bill</Link>}</div>
            </div>
          )}

          {editable && (job || bill) && services && <AddBar services={services} onAdd={addItem} />}

          <div className="lines" role="table" aria-label="Bill items">
            <div className="lines__head" role="row"><span>Service</span><span className="ta-c">Qty</span><span className="ta-r">Rate</span><span className="ta-r">Amount</span><span /></div>
            {lines.length === 0 && <div className="lines__empty">{job || bill ? 'No items yet. Search above to add the first one.' : 'Select a job to start.'}</div>}
            {lines.map((l, i) => {
              const master = price(l.serviceId);
              const overridden = !!master && l.rate !== master;
              if (editing === l.key && draft) {
                return (
                  <div className="line is-editing" key={l.key} role="row">
                    <div className="line__edit">
                      <select className="select" value={draft.serviceId} onChange={(e) => { const sid = Number(e.target.value); setDraft({ ...draft, serviceId: sid, rate: canRate ? draft.rate : price(sid) }); }} aria-label="Service">
                        {services?.map((s) => <option key={s.id} value={s.id}>{s.name} — {money(s.price)}</option>)}
                      </select>
                      <div className="line__edit-row">
                        <label>Qty <input className="input num" inputMode="numeric" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: Number(e.target.value.replace(/\D/g, '')) || 0 })} onKeyDown={(e) => e.key === 'Enter' && saveEdit()} autoFocus /></label>
                        <label>Rate {!canRate && <Lock size={11} />}{canRate ? <MoneyInput value={draft.rate} onChange={(v) => setDraft({ ...draft, rate: Number(v || 0) })} /> : <input className="input num" value={money(draft.rate)} readOnly />}</label>
                        <span className="line__edit-amt num">{money(Math.max(1, draft.qty) * draft.rate)}</span>
                      </div>
                      {canRate && draft.rate !== price(draft.serviceId) && (
                        <span className="line__note">Overriding master rate {money(price(draft.serviceId))} — will be audited. <button type="button" className="linkish" onClick={() => setDraft({ ...draft, rate: price(draft.serviceId) })}>Reset</button></span>
                      )}
                    </div>
                    <div className="line__actions">
                      <button className="icon-btn sm ok" onClick={saveEdit} aria-label="Save line"><Check /></button>
                      <button className="icon-btn sm" onClick={() => setEditing(null)} aria-label="Cancel edit"><X /></button>
                    </div>
                  </div>
                );
              }
              return (
                <div className={`line ${flash === l.key ? 'is-flash' : ''}`} key={l.key} role="row">
                  <div className="line__name"><span className="line__no">{i + 1}</span><div><strong>{l.name}</strong>{overridden && <small><em>master {money(master)}</em></small>}</div></div>
                  <div className="ta-c">
                    {editable ? (
                      <span className="stepper-qty">
                        <button onClick={() => (l.qty === 1 ? remove(l.key) : setQty(l.key, l.qty - 1))} aria-label={l.qty === 1 ? 'Remove item' : 'Decrease quantity'}><Minus /></button>
                        <input className="num" inputMode="numeric" value={l.qty} onChange={(e) => setQty(l.key, Number(e.target.value.replace(/\D/g, '')) || 1)} aria-label="Quantity" />
                        <button onClick={() => setQty(l.key, l.qty + 1)} aria-label="Increase quantity"><Plus /></button>
                      </span>
                    ) : <span className="num">{l.qty}</span>}
                  </div>
                  <div className="ta-r num">{money(l.rate)}{overridden && <span className="override-tag">override</span>}</div>
                  <div className="ta-r num line__amt">{money(l.qty * l.rate)}</div>
                  <div className="line__actions">
                    {editable && (
                      <>
                        <button className="icon-btn sm" onClick={() => { setEditing(l.key); setDraft({ serviceId: l.serviceId, qty: l.qty, rate: l.rate }); }} aria-label={`Edit ${l.name}`} data-tip="Edit"><Pencil /></button>
                        <button className="icon-btn sm danger" onClick={() => remove(l.key)} aria-label={`Delete ${l.name}`} data-tip="Delete"><Trash2 /></button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {removed && (
            <div className="undo-bar" role="status">
              <span>Removed <strong>{removed.line.name}</strong></span>
              <button className="btn btn-ghost btn-sm" onClick={undo}><RotateCcw /> Undo</button>
            </div>
          )}

          <div className="billdesk__totals">
            <div className="row-between"><span className="muted">Subtotal · {lines.reduce((t, l) => t + l.qty, 0)} units</span><span className="num">{money(sub)}</span></div>
            <div className="row-between" style={{ alignItems: 'flex-start' }}>
              <label htmlFor="disc" className="muted" style={{ paddingTop: 8 }}>Discount (fixed ₹)</label>
              <div style={{ width: 150, textAlign: 'right', paddingTop: editable ? 0 : 8 }}>
                {editable ? <MoneyInput id="disc" value={discount} onChange={setDiscount} /> : <span className="num">− {money(disc)}</span>}
                {discountError && <span className="field__error" style={{ marginTop: 4 }}>{discountError}</span>}
              </div>
            </div>
            <div className="row-between grand"><span>Grand total</span><span className="num">{money(total)}</span></div>
          </div>

          <div className="billdesk__job" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="form-grid">
              <Field label="Service login username" htmlFor="pu" hint={bill && usernameDirty ? 'Save changes before sharing the updated username.' : 'Saved with the bill.'}>
                <input id="pu" className="input" disabled={!editable || busy || pdfBusy} autoComplete="off" autoCapitalize="none" spellCheck={false}
                  maxLength={256} value={serviceUsername} onChange={(e) => { setDraftUsername(e.target.value); setIncludeLogin(false); }} />
              </Field>
              <Field label="Service login password" htmlFor="pp" hint="Kept for this bill session. Enter it again after reopening the bill.">
                <input id="pp" className="input" type="password" disabled={busy || pdfBusy} autoComplete="new-password" maxLength={256}
                  value={servicePassword} onChange={(e) => { setServicePassword(e.target.value); setIncludeLogin(false); }} />
              </Field>
              <label className="check span-2">
                <input type="checkbox" checked={includeLogin} disabled={(!username && !servicePassword) || pdfBusy}
                  onChange={(e) => setIncludeLogin(e.target.checked)} />
                Include Service Login Details in PDF
              </label>
            </div>
          </div>

          {editable && (
            <div className="billdesk__pay">
              <div className="field">
                <span className="field__label">Payment mode · full amount only</span>
                <PayModePicker value={mode} onChange={setMode} />
              </div>
              {mode !== 'Cash' && (
                <Field label="Transaction reference" required={mode === 'Bank'} htmlFor="bref"><input id="bref" className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
              )}
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-secondary" disabled={busy || !dirty || !lines.length || !!discountError || (!bill && !job)} onClick={saveOnly}>{bill ? 'Save changes' : 'Save as unpaid'}</button>
                <button className="btn btn-accent btn-lg" style={{ flex: 1 }} disabled={busy || !lines.length || total <= 0 || !!discountError || (!bill && !job) || (mode === 'Bank' && !reference.trim())} onClick={() => setPayOpen(true)}>Receive {money(total)}</button>
              </div>
            </div>
          )}
        </section>

        <section className="billdesk__preview">
          <div className="billdesk__preview-head no-print"><span>Bill preview · A5, both sides</span><span className="muted">{editable ? 'updates as you edit' : status}</span></div>
          <ServiceBillPrint b={print} />
          <PrintArea>
            <ServiceBillPrint b={print} />
          </PrintArea>
        </section>
      </div>

      {shareBill && sharePrint && (
        <WhatsAppSend open onClose={() => setShareBill(null)} title={`Send bill ${shareBill.code}`} name={shareBill.customer.name}
          phone={shareBill.customer.whatsapp_number || shareBill.customer.mobile} recordLabel="customer’s profile"
          message={billMessage(shareBill)} serviceLogin={shareLogin}
          pdf={(serviceLogin) => billPdf(serviceLogin ? { ...sharePrint, serviceLogin } : sharePrint)}
          automaticPath={shareBill.status === 'Paid' ? `/service-bills/${shareBill.code}/whatsapp-delivery` : undefined}
          onShared={(event_type) => api(`/service-bills/${shareBill.code}/share-events`, { method: 'POST', body: { event_type } }).catch(() => {})} />
      )}

      <Confirm open={payOpen} onClose={() => setPayOpen(false)} icon={<Check />} title={`Receive ${money(total)} from ${customer?.name}?`} body={`Full payment by ${PAY_LABEL[mode]}. The bill is locked once paid.`} confirmLabel="Confirm payment" busy={busy} onConfirm={pay}>
        <div className="summary-box">
          <div className="kv"><span>Items</span><strong>{lines.length}</strong></div>
          <div className="kv"><span>Mode</span><strong>{PAY_LABEL[mode]}{reference && ` · ${reference}`}</strong></div>
          <div className="kv total"><span>Amount</span><strong>{money(total)}</strong></div>
        </div>
      </Confirm>

      {bill && (
        <Confirm
          open={cancelOpen}
          onClose={() => setCancelOpen(false)}
          tone="danger"
          icon={<Ban />}
          title={`Cancel bill ${bill.code}?`}
          body={`${money(bill.grand_total)} for ${customer?.name} will be excluded from revenue and reports. The bill stays in history.${bill.status === 'Paid' ? ' A replacement bill can’t collect money again until the refund rule is decided.' : ''}`}
          confirmLabel="Cancel bill"
          busy={busy}
          disabled={reason.trim().length < 5 || confirmNo.trim().toUpperCase() !== bill.code.toUpperCase()}
          onConfirm={async () => {
            setBusy(true);
            try {
              await write(api(`/service-bills/${bill.code}/cancel`, { method: 'POST', body: { reason: reason.trim() } }));
              setCancelOpen(false);
              toast('success', 'Bill cancelled', bill.code);
            } catch (e) {
              toast('error', errText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="stack" style={{ gap: 14 }}>
            <Field label="Reason" required htmlFor="cr" hint="Minimum 5 characters — recorded in the audit log"><textarea id="cr" className="textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <Field label={`Type ${bill.code} to confirm`} required htmlFor="cno"><input id="cno" className="input id" value={confirmNo} onChange={(e) => setConfirmNo(e.target.value)} autoComplete="off" /></Field>
          </div>
        </Confirm>
      )}
    </>
  );
}

/* Search-to-add bar: type, arrow to choose, Enter adds. Quantity can be set first. */
function AddBar({ services, onAdd }: { services: Service[]; onAdd: (s: Service, qty: number) => void }) {
  const [q, setQ] = useState('');
  const [qty, setQty] = useState(1);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? services.filter((x) => x.name.toLowerCase().includes(s) || x.category.name.toLowerCase().includes(s)) : services).slice(0, 8);
  }, [q, services]);
  const add = (s: Service) => {
    onAdd(s, Math.max(1, qty));
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
            onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === 'Enter' && results[active]) { e.preventDefault(); add(results[active]); }
              else if (e.key === 'Escape') setOpen(false);
            }}
            aria-label="Search service to add"
          />
          {open && results.length > 0 && (
            <div className="combo__list">
              {results.map((s, i) => (
                <button key={s.id} type="button" className={`combo__item ${i === active ? 'is-active' : ''}`} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => add(s)}>
                  <span style={{ flex: 1, minWidth: 0 }}><strong style={{ fontWeight: 500, fontSize: 13.5 }}>{s.name}</strong><br /><small className="muted">{s.category.name}</small></span>
                  <span className="num" style={{ fontSize: 13 }}>{money(s.price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <label className="addbar__qty"><span>Qty</span><input className="input num" inputMode="numeric" value={qty} onChange={(e) => setQty(Number(e.target.value.replace(/\D/g, '')) || 1)} aria-label="Quantity to add" /></label>
        <button className="btn btn-primary" disabled={!results[active] || !q.trim()} onClick={() => results[active] && add(results[active])}><Plus /> Add</button>
      </div>
    </div>
  );
}
