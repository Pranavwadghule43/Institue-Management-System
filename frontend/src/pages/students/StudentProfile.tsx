import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  Archive, BookOpen, CalendarClock, CalendarDays, CheckCircle2, Clock, Eye, EyeOff, FileText, IndianRupee, MessageCircle, Pencil, Phone, Printer, ReceiptText, UserX,
} from 'lucide-react';
import { errText, useApp } from '../../app/AppContext';
import {
  Avatar, Badge, Confirm, Drawer, Empty, FeeStateBadge, Field, InstBadge, LoadError, Menu, PageHeader, Panel, Progress, SkeletonRows, StatusDot, Tabs,
} from '../../components/ui';
import { api, useQuery, write } from '../../api/client';
import type { FeeSummary, Payment, Ref, Student, TimeSlot } from '../../api/types';
import { date, dateTime, iso, money, n, relDays, toDate } from '../../lib/format';
import { feeReminderText, waLink } from '../../lib/whatsapp';
import NotFound from '../NotFound';
import { PlanEditor, planError, type PlanRow } from '../../components/PlanEditor';
import { SubtypeChecks } from '../../components/SubtypeChecks';
import { eligibleTimeSlots } from '../../lib/schedule';

type Tab = 'overview' | 'fees' | 'receipts' | 'activity';
interface Activity { at: string; type: string; title: string; by: Ref | null; ref?: string | null; note?: string | null; action?: string }
interface Profile { student: Student; fees: FeeSummary | null; payments: Payment[]; receipts: { receipt_no: string; issued_at: string; amount: string }[]; last_reminded_at: string | null; activity: Activity[] }

export default function StudentProfile() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { can, role, toast } = useApp();
  const [tab, setTab] = useState<Tab>('overview');
  const [aadhaar, setAadhaar] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'' | 'edit' | 'slot' | 'left' | 'completed' | 'archive' | 'plan'>(params.get('edit') ? 'edit' : '');
  const { data, error, loading } = useQuery<Profile>(`/students/${id}/profile`);
  if (error?.status === 404) return <NotFound what="student" />;
  if (error) return <LoadError error={error} />;
  if (loading || !data) return <SkeletonRows rows={6} cols={4} />;
  const s = data.student;
  const fees = data.fees;
  const nx = fees?.next_due;
  const closeDialog = () => {
    setDialog('');
    if (params.get('edit')) setParams({});
  };
  const reveal = async () => {
    if (aadhaar) return setAadhaar(null);
    try {
      setAadhaar((await api<{ aadhaar: string }>(`/students/${s.code}/aadhaar`)).aadhaar);
    } catch (e) {
      toast('error', errText(e));
    }
  };
  const editable = !s.archived;

  return (
    <>
      <PageHeader title="Student profile" crumbs={[['Students', '/students'], [s.full_name]]} />
      {s.archived && <div className="callout warning" style={{ marginBottom: 16 }}><Archive /> <span>This student is archived (Deleted History). Payments and receipts remain available.</span></div>}

      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="profile-head">
          <Avatar name={s.full_name} size="xl" />
          <div className="profile-head__meta">
            <h1>
              {s.full_name} <StatusDot s={s.status} /> {fees && <FeeStateBadge s={fees.fee_state} />}
            </h1>
            <div className="profile-head__facts">
              <span className="id">{s.code}</span>
              <span><Phone /> {s.mobile}</span>
              <span><BookOpen /> {s.course.code} · {s.time_slot.name}</span>
              <span><Clock /> {s.time_slot.timing}</span>
              <span><CalendarDays /> Admitted {date(s.admission_date)}</span>
            </div>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {nx && fees && (
              <a className="btn btn-whatsapp" href={waLink(s.whatsapp_number || s.mobile, feeReminderText(s.full_name, nx.amount, nx.due_date, fees.balance))} target="_blank" rel="noreferrer">
                <MessageCircle /> Remind
              </a>
            )}
            {can('fees.collect') && fees && n(fees.balance) > 0 && editable && (
              <Link className="btn btn-primary" to={`/fees/collect?student=${s.code}`}>
                <IndianRupee /> Collect fee
              </Link>
            )}
            {can('students.edit') && editable && (
              <button className="btn btn-secondary" onClick={() => setDialog('edit')}>
                <Pencil /> Edit
              </button>
            )}
            <Menu>
              {can('students.edit') && editable && (
                <button className="menu__item" onClick={() => setDialog('slot')}>
                  <BookOpen /> Change batch
                </button>
              )}
              <button className="menu__item" onClick={() => window.print()}>
                <Printer /> Print profile
              </button>
              {can('students.edit') && editable && s.status === 'Active' && (
                <>
                  <div className="menu__sep" />
                  <button className="menu__item" onClick={() => setDialog('completed')}>
                    <CheckCircle2 /> Mark completed
                  </button>
                  <button className="menu__item danger" onClick={() => setDialog('left')}>
                    <UserX /> Mark as left
                  </button>
                </>
              )}
              {can('students.delete') && editable && (
                <button className="menu__item danger" onClick={() => setDialog('archive')}>
                  <Archive /> Archive student
                </button>
              )}
            </Menu>
          </div>
        </div>
        {fees && (
          <div className="fee-hero">
            <div>
              <span>Net fee</span>
              <strong>{money(fees.net_fee)}</strong>
              {n(fees.discount) > 0 && <div className="muted" style={{ fontSize: 12 }}>after {money(fees.discount)} discount</div>}
            </div>
            <div>
              <span>Paid</span>
              <strong style={{ color: 'var(--success-700)' }}>{money(fees.total_paid)}</strong>
              <div className="row" style={{ gap: 8, marginTop: 4 }}>
                <Progress value={fees.paid_pct} tone="success" />
                <span className="muted num" style={{ fontSize: 12 }}>{fees.paid_pct}%</span>
              </div>
            </div>
            <div>
              <span>Balance</span>
              <strong style={{ color: n(fees.balance) ? 'var(--danger-700)' : undefined }}>{money(fees.balance)}</strong>
            </div>
            <div>
              <span>Next due</span>
              {nx ? (
                <>
                  <strong>{money(nx.amount)}</strong>
                  <div style={{ fontSize: 12, fontWeight: 600, color: fees.fee_state === 'Overdue' ? 'var(--danger-700)' : 'var(--ink-3)' }}>
                    {date(nx.due_date)} · {relDays(nx.due_date)}
                  </div>
                </>
              ) : (
                <strong style={{ color: 'var(--success-700)' }}>Fully paid</strong>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <div style={{ padding: '0 8px' }}>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'overview', label: 'Overview' },
              ...(fees ? [{ value: 'fees' as Tab, label: 'Fees & payments', count: data.payments.length }, { value: 'receipts' as Tab, label: 'Receipts', count: data.receipts.length }] : []),
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
                  <dd>{s.guardian_name}</dd>
                  <dt>Date of birth</dt>
                  <dd>{date(s.dob)}</dd>
                  <dt>Gender</dt>
                  <dd>{s.gender ?? '—'}</dd>
                  <dt>Mobile</dt>
                  <dd className="num">{s.mobile}</dd>
                  <dt>WhatsApp</dt>
                  <dd className="num">{s.whatsapp_number && s.whatsapp_number !== s.mobile ? s.whatsapp_number : <span className="muted">Same as mobile</span>}</dd>
                  <dt>Email</dt>
                  <dd>{s.email || <span className="muted">—</span>}</dd>
                  <dt>Address</dt>
                  <dd>{s.address}</dd>
                  <dt>Aadhaar</dt>
                  <dd className="num">
                    <span className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      {aadhaar ?? s.aadhaar_masked ?? <span className="muted">—</span>}
                      {role === 'Admin' && s.aadhaar_masked && (
                        <button className="icon-btn sm" onClick={reveal} aria-label={aadhaar ? 'Hide Aadhaar' : 'Reveal Aadhaar (audited)'} data-tip={aadhaar ? 'Hide' : 'Reveal (audited)'}>
                          {aadhaar ? <EyeOff /> : <Eye />}
                        </button>
                      )}
                    </span>
                  </dd>
                </dl>
              </Panel>
              <Panel title="Enrolment">
                <dl className="kv-list">
                  <dt>Course</dt>
                  <dd>{s.course.name}</dd>
                  {s.course_subtypes?.length > 0 && (
                    <>
                      <dt>{s.course_subtypes.length === 1 ? 'Sub-type' : 'Sub-types'}</dt>
                      <dd>{s.course_subtypes.map((x) => x.name).join(', ')}</dd>
                    </>
                  )}
                  <dt>Duration</dt>
                  <dd>{s.course.duration_months ? `${s.course.duration_months} months` : '—'}</dd>
                  <dt>Batch</dt>
                  <dd>{s.time_slot.name}</dd>
                  <dt>Timing</dt>
                  <dd>{s.time_slot.timing} · {s.time_slot.days}</dd>
                  <dt>Faculty</dt>
                  <dd>{s.time_slot.faculty ?? '—'}</dd>
                  <dt>Agreed fee</dt>
                  <dd className="num">{money(s.agreed_fee)}</dd>
                  <dt>Discount</dt>
                  <dd className="num">{money(s.discount)}</dd>
                </dl>
              </Panel>
            </div>
          </div>
        )}

        {tab === 'fees' && fees && (
          <>
            <div className="panel__head">
              <h2>Installment schedule</h2>
              {can('fees.collect') && editable && n(fees.balance) > 0 && (
                <button className="btn btn-secondary btn-sm" onClick={() => setDialog('plan')}><CalendarClock /> Edit installment plan</button>
              )}
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>#</th><th>Due date</th><th className="ta-r">Amount</th><th className="ta-r">Paid</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {fees.schedule.map((r) => (
                    <tr key={r.no}>
                      <td>{r.label}</td>
                      <td>{date(r.due_date)}</td>
                      <td className="ta-r num">{money(r.amount)}</td>
                      <td className="ta-r num">{money(r.paid)}</td>
                      <td><InstBadge s={r.state} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel__head" style={{ borderTop: '1px solid var(--line)' }}><h2>Payment history</h2></div>
            <PaymentsTable rows={data.payments} />
          </>
        )}

        {tab === 'receipts' &&
          (data.receipts.length ? (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {data.receipts.map((x) => (
                    <tr key={x.receipt_no}>
                      <td>
                        <div className="row">
                          <span className="feed-item__ico money"><ReceiptText /></span>
                          <div>
                            <div className="id" style={{ fontWeight: 600, color: 'var(--ink)' }}>{x.receipt_no}</div>
                            <div className="muted" style={{ fontSize: 12 }}>{dateTime(x.issued_at)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="ta-r num" style={{ fontWeight: 700 }}>{money(x.amount)}</td>
                      <td className="ta-r">
                        <Link className="btn btn-secondary btn-sm" to={`/fees/receipts/${x.receipt_no}`}><Printer /> View / print</Link>
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
              {data.activity.map((a, i) => (
                <div className="tl-item" key={i}>
                  <span className={`tl-item__dot ${a.type === 'payment' ? 'success' : a.type === 'reversal' ? 'danger' : a.type === 'reminder' ? 'info' : 'primary'}`}>
                    {a.type === 'payment' || a.type === 'reversal' ? <IndianRupee /> : a.type === 'reminder' ? <MessageCircle /> : <BookOpen />}
                  </span>
                  <div className="tl-item__title">{a.title}</div>
                  <div className="tl-item__meta">{dateTime(a.at)}{a.by && ` · by ${a.by.name}`}{a.ref && ` · ${a.ref}`}</div>
                  {a.note && <div className="tl-item__note">{a.note}</div>}
                </div>
              ))}
              <div className="tl-item">
                <span className="tl-item__dot primary"><BookOpen /></span>
                <div className="tl-item__title">Admitted to {s.course.code}</div>
                <div className="tl-item__meta">{date(s.admission_date)}</div>
              </div>
            </div>
          </div>
        )}
      </section>

      <EditStudent open={dialog === 'edit'} s={s} onClose={closeDialog} />
      <ChangeSlot open={dialog === 'slot'} s={s} onClose={closeDialog} />
      {fees && <EditPlan open={dialog === 'plan'} s={s} fees={fees} onClose={closeDialog} />}
      <ReasonDialog
        open={dialog === 'left' || dialog === 'completed' || dialog === 'archive'}
        onClose={closeDialog}
        title={dialog === 'archive' ? `Archive ${s.full_name}?` : `Mark ${s.full_name} as ${dialog === 'left' ? 'left' : 'completed'}?`}
        body={dialog === 'archive' ? 'The student moves to Deleted History. Payments and receipts are kept.' : 'The change is recorded in the activity history.'}
        required={dialog !== 'completed'}
        confirmLabel={dialog === 'archive' ? 'Archive student' : dialog === 'left' ? 'Mark as left' : 'Mark completed'}
        run={(reason) => api(`/students/${s.code}/${dialog === 'archive' ? 'archive' : dialog === 'left' ? 'mark-left' : 'mark-completed'}`, { method: 'POST', body: { reason: reason || null } })}
      />
    </>
  );
}

function ReasonDialog({ open, onClose, title, body, required, confirmLabel, run }: { open: boolean; onClose: () => void; title: string; body: string; required: boolean; confirmLabel: string; run: (reason: string) => Promise<unknown> }) {
  const { toast } = useApp();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setReason(''), [open]);
  return (
    <Confirm open={open} onClose={onClose} tone="danger" icon={<UserX />} title={title} body={body} confirmLabel={confirmLabel} busy={busy}
      disabled={required && reason.trim().length < 5}
      onConfirm={async () => {
        setBusy(true);
        try {
          await write(run(reason.trim()));
          toast('success', 'Saved');
          onClose();
        } catch (e) {
          toast('error', errText(e));
        } finally {
          setBusy(false);
        }
      }}>
      <Field label="Reason" required={required} hint={required ? 'Minimum 5 characters — kept in the audit log' : 'Optional'} htmlFor="sreason">
        <textarea id="sreason" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Confirm>
  );
}

function EditStudent({ open, s, onClose }: { open: boolean; s: Student; onClose: () => void }) {
  const { toast } = useApp();
  const init = () => ({ full_name: s.full_name, guardian_name: s.guardian_name, dob: s.dob, gender: s.gender ?? 'Male', mobile: s.mobile,
    whatsapp_number: s.whatsapp_number ?? '', email: s.email ?? '', address: s.address, aadhaar: '' });
  const [f, setF] = useState(init);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // sub-types are only sent when changed, so an edit never drops one that was made inactive later
  const [subs, setSubs] = useState<number[] | null>(null);
  useEffect(() => {
    if (open) {
      setF(init());
      setSubs(null);
      setErrs({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (k: keyof ReturnType<typeof init>, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { ...f, whatsapp_number: f.whatsapp_number || f.mobile };
      if (subs !== null) body.course_subtype_ids = subs;
      if (!f.aadhaar) delete body.aadhaar; // blank keeps the stored Aadhaar
      await write(api(`/students/${s.code}`, { method: 'PATCH', body }));
      toast('success', 'Student updated');
      onClose();
    } catch (e) {
      setErrs((e as { fields?: Record<string, string> }).fields ?? {});
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open={open} onClose={onClose} title="Edit student" sub={`${s.code} · course and fees can’t be changed here`}
      foot={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy && <span className="spinner" />}Save changes</button></>}>
      <div className="form-grid">
        <Field label="Full name" required className="span-2" error={errs.full_name} htmlFor="e-name"><input id="e-name" className="input" value={f.full_name} onChange={(e) => set('full_name', e.target.value)} /></Field>
        <Field label="Father / guardian" required error={errs.guardian_name} htmlFor="e-g"><input id="e-g" className="input" value={f.guardian_name} onChange={(e) => set('guardian_name', e.target.value)} /></Field>
        <Field label="Date of birth" required error={errs.dob} htmlFor="e-dob"><input id="e-dob" type="date" className="input" max={iso(new Date())} value={f.dob} onChange={(e) => set('dob', e.target.value)} /></Field>
        <Field label="Gender" htmlFor="e-gen"><select id="e-gen" className="select" value={f.gender} onChange={(e) => set('gender', e.target.value)}><option>Male</option><option>Female</option></select></Field>
        <Field label="Mobile" required error={errs.mobile} htmlFor="e-m"><input id="e-m" className="input num" value={f.mobile} onChange={(e) => set('mobile', e.target.value)} /></Field>
        <Field label="WhatsApp number" error={errs.whatsapp_number} hint="Blank = same as mobile" htmlFor="e-wa"><input id="e-wa" className="input num" value={f.whatsapp_number} onChange={(e) => set('whatsapp_number', e.target.value)} /></Field>
        <Field label="Email" error={errs.email} htmlFor="e-em"><input id="e-em" className="input" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Aadhaar" error={errs.aadhaar} hint={s.aadhaar_masked ? `Blank keeps ${s.aadhaar_masked}` : 'Optional, 12 digits'} htmlFor="e-ad"><input id="e-ad" className="input num" value={f.aadhaar} onChange={(e) => set('aadhaar', e.target.value)} /></Field>
        <Field label="Address" required className="span-2" error={errs.address} htmlFor="e-addr"><textarea id="e-addr" className="textarea" rows={2} value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <SubtypeChecks courseId={open ? s.course.id : null} value={subs ?? s.course_subtypes.map((x) => x.id)} onChange={setSubs} error={errs.course_subtype_ids ?? errs.course_subtype_id} />
      </div>
    </Drawer>
  );
}

// 16 Nov (client): change the dates and amounts still to be paid. Money already received stays where it is.
function EditPlan({ open, s, fees, onClose }: { open: boolean; s: Student; fees: FeeSummary; onClose: () => void }) {
  const { toast } = useApp();
  const remaining = (): PlanRow[] => fees.schedule.filter((r) => r.no > 0 && n(r.paid) < n(r.amount)).map((r) => ({ due: r.due_date, amount: n(r.amount) - n(r.paid) }));
  const [rows, setRows] = useState<PlanRow[]>(remaining);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState('');
  useEffect(() => {
    if (open) {
      setRows(remaining());
      setReason('');
      setTried(false);
      setServerErr('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const balance = n(fees.balance);
  const settled = fees.schedule.filter((r) => r.no > 0 && n(r.paid) > 0);
  const problem = planError(rows, balance, s.admission_date);
  const save = async () => {
    setTried(true);
    if (problem) return;
    setBusy(true);
    try {
      await write(api(`/students/${s.code}/installment-plan`, { method: 'PUT', body: { installments: rows.map((r) => ({ due_date: r.due, amount: String(r.amount) })), reason: reason.trim() || null } }));
      toast('success', 'Installment plan updated', `${rows.length} ${rows.length === 1 ? 'installment' : 'installments'} · ${money(balance)}`);
      onClose();
    } catch (e) {
      setServerErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open={open} onClose={onClose} title="Edit installment plan" sub={`${s.full_name} · ${money(balance)} still to be paid`}
      foot={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy && <span className="spinner" />}Save plan</button></>}>
      <div className="stack">
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Total fee stays {money(fees.net_fee)}; {money(fees.total_paid)} already received stays as it is.
          {settled.length > 0 && ` ${settled.length === 1 ? 'Installment 1 keeps' : `Installments 1–${settled.length} keep`} what was paid on ${settled.length === 1 ? 'it' : 'them'}.`}
        </p>
        <PlanEditor rows={rows} onChange={setRows} balance={balance} minDate={s.admission_date} startNo={settled.length + 1} error={(tried && problem) || serverErr || null} />
        <Field label="Reason" hint="Saved in the audit log" htmlFor="ep-r"><textarea id="ep-r" className="textarea" placeholder="e.g. Parent asked to pay on the 10th" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Drawer>
  );
}

function ChangeSlot({ open, s, onClose }: { open: boolean; s: Student; onClose: () => void }) {
  const { toast } = useApp();
  const [slot, setSlot] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: slots, error, loading, reload } = useQuery<TimeSlot[]>(open ? '/time-slots' : null, { course_id: s.course.id, active: true, include_completed: false });
  const subtypeIds = s.course_subtypes.length ? s.course_subtypes.map((subtype) => subtype.id) : s.course_subtype ? [s.course_subtype.id] : [];
  const eligible = eligibleTimeSlots(slots, s.course.id, subtypeIds)?.filter((option) => option.id !== s.time_slot.id);
  const selected = eligible?.some((option) => String(option.id) === slot) ?? false;
  useEffect(() => {
    setSlot('');
    setReason('');
  }, [open]);
  const save = async () => {
    setBusy(true);
    try {
      const r = await write(api<{ capacity_warning: boolean }>(`/students/${s.code}/change-time-slot`, { method: 'POST', body: { time_slot_id: Number(slot), reason } }));
      toast(r.capacity_warning ? 'info' : 'success', 'Batch changed', r.capacity_warning ? 'The new batch is now over capacity.' : undefined);
      onClose();
    } catch (e) {
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open={open} onClose={onClose} title="Change batch" sub={`Currently ${s.time_slot.name} · ${s.time_slot.timing}`}
      foot={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !selected || !!error} onClick={save}>{busy && <span className="spinner" />}Move student</button></>}>
      <div className="stack">
        <Field label="New time slot" required htmlFor="cs-slot" hint={error ?
          <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>Could not load time slots. Retry</button>
          : loading ? 'Loading time slots…' : eligible?.length === 0 ? 'There are no other compatible time slots.' : undefined}>
          <select id="cs-slot" className="select" value={selected ? slot : ''} disabled={!eligible?.length || !!error} onChange={(e) => setSlot(e.target.value)}>
            <option value="">Select…</option>
            {eligible?.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.course_subtype?.name ?? 'Course-wide'} · {x.timing} · {x.seats_left} seats left</option>)}
          </select>
        </Field>
        <Field label="Reason" htmlFor="cs-r"><textarea id="cs-r" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Drawer>
  );
}

export function PaymentsTable({ rows, showStudent }: { rows: Payment[]; showStudent?: boolean }) {
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
          {rows.map((x) => (
            <tr key={x.id} style={x.status === 'Reversed' ? { opacity: 0.65 } : undefined}>
              <td className="id">{x.receipt_no}</td>
              {showStudent && (
                <td>
                  <Link to={`/students/${x.student.code}`} style={{ color: 'inherit', fontWeight: 600 }}>{x.student.name}</Link>
                  <div className="muted" style={{ fontSize: 12 }}>{x.student.code}</div>
                </td>
              )}
              <td>{dateTime(toDate(x.received_at))}</td>
              <td>
                <span className="tag">{x.mode_label}</span>
                {x.reference && <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{x.reference}</div>}
              </td>
              <td>{x.collected_by?.name ?? '—'}</td>
              <td className="ta-r num" style={{ fontWeight: 700, textDecoration: x.status === 'Reversed' ? 'line-through' : undefined }}>{money(x.amount)}</td>
              <td>{x.status === 'Valid' ? <Badge tone="success" dot>Valid</Badge> : <Badge tone="danger" dot>Reversed</Badge>}</td>
              <td className="ta-r">
                {x.receipt_no && (
                  <Link className="icon-btn sm" to={`/fees/receipts/${x.receipt_no}`} aria-label="View receipt" data-tip="Receipt">
                    <Printer />
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
