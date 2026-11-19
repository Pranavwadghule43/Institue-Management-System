import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Info, Printer, Save } from 'lucide-react';
import { errText, useApp } from '../../app/AppContext';
import { Avatar, Field, LoadError, Modal, MoneyInput, PageHeader, Segmented } from '../../components/ui';
import { api, newKey, useQuery, write } from '../../api/client';
import type { Course, Enquiry, FeeSummary, PayMode, Receipt, Student, Subtype, TimeSlot } from '../../api/types';
import { date, iso, money, n } from '../../lib/format';
import { PayModePicker } from '../../components/PayModePicker';
import { PlanEditor, evenPlan, planError, type PlanRow } from '../../components/PlanEditor';
import { SubtypeChecks, activeOnly } from '../../components/SubtypeChecks';
import { eligibleTimeSlots } from '../../lib/schedule';

interface AdmitResult { student: Student; fees: FeeSummary; capacity_warning: boolean; receipt: Receipt | null }

export default function Admission() {
  const { toast } = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const code = params.get('enquiry');
  const { data: enquiry, error: enqError } = useQuery<Enquiry>(code ? `/enquiries/${code}` : null);
  const firstDueDefault = new Date();
  firstDueDefault.setMonth(firstDueDefault.getMonth() + 1);

  const [f, setF] = useState({
    name: '', fatherName: '', dob: '', gender: 'Male' as 'Male' | 'Female', phone: '', sameWa: true, whatsapp: '', email: '', address: '', aadhaar: '',
    courseId: '', subtypeIds: [] as number[], batchId: '', discount: 0 as number | '', initial: '' as number | '', mode: 'Cash' as PayMode, reference: '', installments: 3,
    firstDue: iso(firstDueDefault),
  });
  const [prefilled, setPrefilled] = useState('');
  if (enquiry && prefilled !== enquiry.code) {
    setPrefilled(enquiry.code);
    setF((x) => ({ ...x, name: enquiry.student_name, fatherName: enquiry.guardian_name ?? '', phone: enquiry.mobile, email: enquiry.email ?? '',
      address: enquiry.address ?? '', courseId: enquiry.course ? String(enquiry.course.id) : '', subtypeIds: (enquiry.course_subtypes ?? []).map((x) => x.id), batchId: '' }));
  }
  const { data: courses } = useQuery<Course[]>('/courses', { active: true });
  const { data: subtypes, error: subtypeError } = useQuery<Subtype[]>(f.courseId ? `/courses/${f.courseId}/subtypes` : null, { active: true });
  const { data: slots, error: slotError, loading: slotsLoading, reload: reloadSlots } =
    useQuery<TimeSlot[]>(f.courseId ? '/time-slots' : null, { course_id: f.courseId, active: true, include_completed: false });
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<AdmitResult | null>(null);
  const key = useRef(newKey());
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const course = courses?.find((c) => String(c.id) === f.courseId) ?? null;
  const selectedSubtypeIds = activeOnly(f.subtypeIds, subtypes);
  const selectedSubtypes = subtypes?.filter((s) => selectedSubtypeIds.includes(s.id)) ?? [];
  const eligible = eligibleTimeSlots(slots, Number(f.courseId), selectedSubtypeIds);
  const batch = eligible?.find((s) => String(s.id) === f.batchId) ?? null;
  const changeSubtypes = (ids: number[]) => setF((current) => ({
    ...current,
    subtypeIds: ids,
    batchId: eligibleTimeSlots(slots, Number(current.courseId), ids)?.some((slot) => String(slot.id) === current.batchId) ? current.batchId : '',
  }));
  const fee = n(course?.fee);
  const discount = Number(f.discount || 0);
  const net = Math.max(0, fee - discount);
  const initial = Number(f.initial || 0);
  const balance = Math.max(0, net - initial);
  const seats = batch?.seats_left ?? 0;
  const todayIso = iso(new Date());
  // 16 Nov (client): dates and amounts can be set by hand. "Number of installments" + "First due date" fill the
  // table with an even monthly split; any row can then be changed. Hand edits stay until those two are changed.
  const [plan, setPlan] = useState<PlanRow[]>([]);
  const [handSet, setHandSet] = useState(false);
  useEffect(() => {
    if (!handSet) setPlan(evenPlan(f.installments, f.firstDue, balance));
  }, [f.installments, f.firstDue, balance, handSet]);
  const planErr = balance > 0 ? planError(plan, balance, todayIso) : null;

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = 'Student name is required';
    else if (f.name.trim().length < 3) e.name = 'Enter the full name';
    if (!f.fatherName.trim()) e.fatherName = 'Father’s / guardian’s name is required';
    if (!f.dob) e.dob = 'Date of birth is required';
    const ph = f.phone.replace(/\D/g, '');
    if (!ph) e.phone = 'Mobile number is required';
    else if (!/^[6-9]\d{9}$/.test(ph)) e.phone = 'Enter a valid 10-digit Indian mobile number';
    if (!f.sameWa && f.whatsapp && !/^[6-9]\d{9}$/.test(f.whatsapp.replace(/\D/g, ''))) e.whatsapp = 'Enter a valid 10-digit number';
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = 'Enter a valid email address';
    if (!f.address.trim()) e.address = 'Address is required';
    if (f.aadhaar && f.aadhaar.replace(/\D/g, '').length !== 12) e.aadhaar = 'Aadhaar must be 12 digits';
    if (!f.courseId) e.courseId = 'Select a course';
    if (!batch) e.batchId = 'Select a compatible batch';
    if (f.subtypeIds.length && (!subtypes || subtypeError)) e.subtypes = 'Wait for the course subtypes to load';
    if (planErr) e.plan = planErr;
    if (discount > fee) e.discount = 'Discount can’t exceed the course fee';
    if (initial > net) e.initial = `Can’t exceed net fee of ${money(net)}`;
    if (initial > 0 && f.mode === 'Bank' && !f.reference.trim()) e.reference = 'UTR / reference is required for bank transfers';
    return e;
  }, [f, batch, subtypes, subtypeError, discount, fee, initial, net, planErr]);
  const err = (k: string, server?: string) => (submitted ? errors[k] : undefined) ?? (server ? serverErrors[server] : undefined);


  const submit = async () => {
    setSubmitted(true);
    if (Object.keys(errors).length) {
      toast('error', 'Please fix the highlighted fields', `${Object.keys(errors).length} field(s) need attention`);
      document.querySelector('.has-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setBusy(true);
    setServerErrors({});
    try {
      const res = await write(api<AdmitResult>(`/enquiries/${enquiry!.code}/convert`, {
        method: 'POST', idempotencyKey: key.current,
        body: {
          full_name: f.name.trim(), guardian_name: f.fatherName.trim(), dob: f.dob, gender: f.gender, mobile: f.phone,
          whatsapp_number: f.sameWa ? null : f.whatsapp || null, email: f.email || null, address: f.address, aadhaar: f.aadhaar || null,
          course_id: Number(f.courseId), course_subtype_ids: selectedSubtypeIds, time_slot_id: Number(f.batchId),
          discount: String(discount), paid_now: String(initial), payment_mode: initial > 0 ? f.mode : null, payment_reference: f.reference || null,
          installments: balance > 0 ? plan.map((r) => ({ due_date: r.due, amount: String(r.amount) })) : [],
        },
      }));
      setDone(res);
    } catch (error) {
      setServerErrors((error as { fields?: Record<string, string> }).fields ?? {});
      toast('error', errText(error));
    } finally {
      setBusy(false);
    }
  };

  if (enqError) return <LoadError error={enqError} />;
  const converted = enquiry?.status === 'Converted';

  return (
    <>
      <PageHeader title="Confirm admission" sub={enquiry ? `From enquiry ${enquiry.code}. Complete the remaining details and save admission.` : 'Open an enquiry to confirm admission.'} crumbs={[['Enquiries', '/enquiries'], ['Confirm admission']]} />
      {!code && <div className="callout warning" style={{ marginBottom: 16 }}><Info /> <span>Select an enquiry first. <Link to="/enquiries">Open enquiries</Link></span></div>}
      {converted && <div className="callout warning" style={{ marginBottom: 16 }}><Info /> <span>This enquiry is already converted. <Link to={`/students/${enquiry!.student_code}`}>View student</Link></span></div>}

      <div className="two-col wide-side">
        <div className="panel">
          <div className="panel__body" style={{ padding: 24 }}>
            <section className="form-section">
              <div className="form-section__title">
                <span className="step">1</span>
                <div>
                  <h3>Personal details</h3>
                  <p>As per school / ID records</p>
                </div>
              </div>
              <div className="form-grid">
                <Field label="Student full name" required error={err('name', 'full_name')} htmlFor="name">
                  <input id="name" className="input" value={f.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" />
                </Field>
                <Field label="Father’s / guardian’s name" required error={err('fatherName', 'guardian_name')} htmlFor="fname">
                  <input id="fname" className="input" value={f.fatherName} onChange={(e) => set('fatherName', e.target.value)} />
                </Field>
                <Field label="Date of birth" required error={err('dob', 'dob')} htmlFor="dob">
                  <input id="dob" type="date" className="input" value={f.dob} max={iso(new Date())} onChange={(e) => set('dob', e.target.value)} />
                </Field>
                <div className="field">
                  <span className="field__label">
                    Gender <span className="req">*</span>
                  </span>
                  <Segmented block value={f.gender} onChange={(v) => set('gender', v)} options={[{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }]} />
                </div>
                <Field label="Mobile number" required error={err('phone', 'mobile')} hint="Used for receipts and WhatsApp reminders" htmlFor="ph">
                  <div className="input-group">
                    <span className="input-prefix" style={{ fontSize: 13 }}>+91</span>
                    <input id="ph" className="input num" style={{ paddingLeft: 44 }} inputMode="numeric" maxLength={11} value={f.phone} onChange={(e) => set('phone', e.target.value.replace(/[^\d ]/g, ''))} />
                  </div>
                </Field>
                <Field label="WhatsApp number" error={err('whatsapp', 'whatsapp_number')} htmlFor="wa">
                  <input id="wa" className="input num" inputMode="numeric" disabled={f.sameWa} value={f.sameWa ? f.phone : f.whatsapp} onChange={(e) => set('whatsapp', e.target.value.replace(/[^\d ]/g, ''))} />
                  <label className="check" style={{ marginTop: 2 }}>
                    <input type="checkbox" checked={f.sameWa} onChange={(e) => set('sameWa', e.target.checked)} /> Same as mobile
                  </label>
                </Field>
                <Field label="Email" error={err('email', 'email')} htmlFor="em">
                  <input id="em" type="email" className="input" value={f.email} onChange={(e) => set('email', e.target.value)} />
                </Field>
                <Field label="Aadhaar number" error={err('aadhaar', 'aadhaar')} hint={enquiry?.aadhaar_masked ? `Leave blank to keep ${enquiry.aadhaar_masked} from the enquiry` : 'Optional · stored encrypted, never shown in lists'} htmlFor="ad">
                  <input id="ad" className="input num" inputMode="numeric" maxLength={14} value={f.aadhaar} onChange={(e) => set('aadhaar', e.target.value.replace(/[^\d]/g, '').replace(/(\d{4})(?=\d)/g, '$1 '))} />
                </Field>
                <Field label="Address" required error={err('address', 'address')} className="span-2" htmlFor="addr">
                  <textarea id="addr" className="textarea" rows={2} value={f.address} onChange={(e) => set('address', e.target.value)} />
                </Field>
              </div>
            </section>

            <section className="form-section">
              <div className="form-section__title">
                <span className="step">2</span>
                <div>
                  <h3>Course & batch</h3>
                  <p>Fee and schedule are saved with the enrolment — later course changes won’t rewrite it</p>
                </div>
              </div>
              <div className="form-grid">
                <Field label="Course" required error={err('courseId', 'course_id')} htmlFor="course" hint={course ? `${course.duration_months ?? '—'} months · ${money(course.fee)}${course.description ? ` · ${course.description}` : ''}` : undefined}>
                  <select id="course" className="select" value={f.courseId} disabled={!!enquiry?.course} onChange={(e) => setF((x) => ({ ...x, courseId: e.target.value, subtypeIds: [], batchId: '' }))}>
                    <option value="">Select course…</option>
                    {courses?.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                  </select>
                </Field>
                <SubtypeChecks courseId={f.courseId} value={f.subtypeIds} onChange={changeSubtypes} error={err('subtypes') ?? serverErrors.course_subtype_ids ?? serverErrors.course_subtype_id} />
                <Field label="Batch" required error={err('batchId', 'time_slot_id')} htmlFor="batch"
                  hint={slotError ? <button type="button" className="btn btn-ghost btn-sm" onClick={reloadSlots}>Could not load time slots. Retry</button>
                    : batch ? `${batch.timing} · ${batch.days}${batch.faculty ? ` · ${batch.faculty}` : ''}`
                      : !f.courseId ? 'Choose a course first' : slotsLoading ? 'Loading time slots…'
                        : eligible?.length === 0 ? 'No active time slots match these subtype selections.' : undefined}>
                  <select id="batch" className="select" value={batch ? f.batchId : ''} disabled={!f.courseId || !eligible?.length || !!slotError} onChange={(e) => set('batchId', e.target.value)}>
                    <option value="">Select batch…</option>
                    {eligible?.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.course_subtype?.name ?? 'Course-wide'} · {b.timing} · {b.seats_left} seats left</option>)}
                  </select>
                </Field>
                {batch && seats <= 3 && (
                  <div className="callout warning span-2">
                    <AlertTriangle />
                    <span>
                      <strong>{seats <= 0 ? 'Batch is full.' : `Only ${seats} seat${seats === 1 ? '' : 's'} left.`}</strong> You can still admit — the batch will exceed its capacity of {batch.capacity}.
                    </span>
                  </div>
                )}
              </div>
            </section>

            <section className="form-section">
              <div className="form-section__title">
                <span className="step">3</span>
                <div>
                  <h3>Fee plan</h3>
                  <p>Initial payment and installment schedule</p>
                </div>
              </div>
              <div className="form-grid cols-3">
                <Field label="Course fee" htmlFor="cf">
                  <div className="input-group">
                    <span className="input-prefix">₹</span>
                    <input id="cf" className="input num" readOnly value={fee ? fee.toLocaleString('en-IN') : '—'} />
                  </div>
                </Field>
                <Field label="Discount" error={err('discount', 'discount')} htmlFor="disc">
                  <MoneyInput id="disc" value={f.discount} onChange={(v) => set('discount', v)} />
                </Field>
                <Field label="Paid now" error={err('initial', 'paid_now')} hint="Receipt is generated automatically" htmlFor="init">
                  <MoneyInput id="init" value={f.initial} onChange={(v) => set('initial', v)} />
                </Field>
                {initial > 0 && (
                  <>
                    <div className="field span-2" style={{ gridColumn: '1 / -1' }}>
                      <span className="field__label">Payment mode</span>
                      <PayModePicker dense value={f.mode} onChange={(v) => set('mode', v)} />
                    </div>
                    {f.mode !== 'Cash' && (
                      <Field label="Transaction reference" required={f.mode === 'Bank'} error={err('reference', 'payment_reference')} htmlFor="pref">
                        <input id="pref" className="input" value={f.reference} onChange={(e) => set('reference', e.target.value)} />
                      </Field>
                    )}
                  </>
                )}
                <Field label="Number of installments" hint="Fills the table below with an even monthly split" htmlFor="inst">
                  <select id="inst" className="select" value={f.installments} onChange={(e) => { setHandSet(false); set('installments', Number(e.target.value)); }} disabled={balance === 0}>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((k) => <option key={k} value={k}>{k} {k === 1 ? 'installment' : 'installments'}</option>)}
                  </select>
                </Field>
                <Field label="First due date" htmlFor="fd">
                  <input id="fd" type="date" className="input" min={todayIso} value={f.firstDue} onChange={(e) => { setHandSet(false); set('firstDue', e.target.value); }} disabled={balance === 0} />
                </Field>
                {balance > 0 && (
                  <div className={`field span-2 ${err('plan', 'installments') ? 'has-error' : ''}`} style={{ gridColumn: '1 / -1' }}>
                    <span className="field__label">Installment dates and amounts <span className="muted" style={{ fontWeight: 400 }}>— change any date or amount</span></span>
                    <PlanEditor rows={plan} balance={balance} minDate={todayIso} error={err('plan', 'installments')}
                      onChange={(rows) => { setHandSet(true); setPlan(rows); }} />
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>

        <aside className="sticky-side stack">
          <section className="panel">
            <div className="panel__head">
              <div>
                <h2>Admission summary</h2>
                <p>Student ID is generated when you save</p>
              </div>
            </div>
            <div className="panel__body">
              <div className="person" style={{ marginBottom: 14 }}>
                {f.name.trim() ? <Avatar name={f.name} /> : <span className="avatar" style={{ background: 'var(--surface-3)' }} />}
                <div className="person__meta">
                  <strong>{f.name.trim() || 'New student'}</strong>
                  <span>{course ? `${course.code} · ${batch?.name ?? 'Batch not selected'}` : 'Course not selected'}</span>
                </div>
              </div>
              <div className="summary-box">
                <div className="kv"><span>Course fee</span><strong className="num">{money(fee)}</strong></div>
                {selectedSubtypes.map((subtype) => <div className="kv" key={subtype.id}>
                  <span>{subtype.name} <small className="muted">(reference fee)</small></span>
                  <strong className="num">{subtype.fee == null ? 'Fee not set' : money(subtype.fee)}</strong>
                </div>)}
                <div className="kv"><span>Discount</span><strong className="num">− {money(discount)}</strong></div>
                <div className="kv"><span>Final payable</span><strong className="num">{money(net)}</strong></div>
                <div className="kv">
                  <span>Paid now {initial > 0 && `(${f.mode})`}</span>
                  <strong className="num" style={{ color: 'var(--success-700)' }}>{money(initial)}</strong>
                </div>
                <div className="kv total"><span>Balance</span><strong className="num">{money(balance)}</strong></div>
              </div>
              {balance > 0 && fee > 0 && (
                <>
                  <div className="row-between" style={{ margin: '16px 0 8px' }}>
                    <h3 style={{ fontSize: 13 }}>Installment schedule</h3>
                    <span className="muted" style={{ fontSize: 12 }}>{plan.length} {plan.length === 1 ? 'installment' : 'installments'}</span>
                  </div>
                  <div className="timeline">
                    {plan.map((r, i) => (
                      <div className="tl-item" key={i} style={{ paddingBottom: 10 }}>
                        <span className="tl-item__dot primary" style={{ fontSize: 9, fontWeight: 700 }}>{i + 1}</span>
                        <div className="row-between">
                          <span style={{ fontSize: 13 }}>{r.due ? date(r.due) : '—'}</span>
                          <strong className="num" style={{ fontSize: 13 }}>{money(Number(r.amount || 0))}</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="panel__foot" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <button className="btn btn-primary btn-lg btn-block" onClick={submit} disabled={busy || !enquiry || converted}>
                {busy ? <span className="spinner" /> : <Save />}
                {busy ? 'Saving admission…' : 'Save admission'}
              </button>
              <Link to="/students" className="btn btn-ghost btn-block">Cancel</Link>
            </div>
          </section>
        </aside>
      </div>

      <Modal open={!!done} onClose={() => nav(`/students/${done?.student.code}`)}>
        {done && (
          <>
            <div className="modal__head">
              <div className="modal__icon success"><CheckCircle2 /></div>
              <div>
                <h2>Admission saved</h2>
                <p><strong>{done.student.full_name}</strong> is enrolled in {done.student.course.code} · {done.student.time_slot.name}.</p>
              </div>
            </div>
            <div className="modal__body">
              <div className="summary-box">
                <div className="kv"><span>Student ID</span><strong className="id">{done.student.code}</strong></div>
                {done.receipt && <div className="kv"><span>Receipt</span><strong className="id">{done.receipt.receipt_no} · {money(done.receipt.snapshot.payment.amount)}</strong></div>}
                <div className="kv"><span>Balance</span><strong>{money(done.fees.balance)}</strong></div>
              </div>
              {done.capacity_warning && <div className="callout warning" style={{ marginTop: 12 }}><AlertTriangle /> <span>This batch is now over its capacity.</span></div>}
            </div>
            <div className="modal__foot">
              {done.receipt && <Link className="btn btn-secondary" to={`/fees/receipts/${done.receipt.receipt_no}`}><Printer /> Print receipt</Link>}
              <Link className="btn btn-primary" to={`/students/${done.student.code}`}>View profile</Link>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
