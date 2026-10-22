import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Camera, CheckCircle2, Info, Printer, Save, UserPlus } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { Avatar, Field, Modal, MoneyInput, PageHeader, Segmented } from '../../components/ui';
import { admitStudent, db, nextStudentId, useStore } from '../../data/store';
import type { PayMode, Payment, Student } from '../../data/types';
import { date, money } from '../../lib/format';
import { PayModePicker } from '../../components/PayModePicker';
import { addMonthsClamped } from '../../lib/schedule';

export const enrolledIn = (batchId: string) => db.students.filter((s) => s.batchId === batchId && s.status === 'Active').length;


export default function Admission() {
  useStore();
  const { user, toast } = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const enquiry = db.enquiries.find((e) => e.id === params.get('enquiry'));
  const firstDueDefault = new Date(db.TODAY);
  firstDueDefault.setMonth(firstDueDefault.getMonth() + 1);

  const blank = {
    name: enquiry?.name ?? '', fatherName: enquiry?.fatherName ?? '', dob: '', gender: 'Male' as 'Male' | 'Female', phone: enquiry?.phone ?? '', sameWa: true, whatsapp: '', email: enquiry?.email ?? '', address: enquiry?.address ?? '', aadhaar: enquiry?.aadhaar ?? '',
    courseId: enquiry?.courseId ?? '', subtypeId: enquiry?.subtypeId ?? '', batchId: '', discount: 0 as number | '', initial: '' as number | '', mode: 'Cash' as PayMode, installments: 3, firstDue: firstDueDefault.toISOString().slice(0, 10),
  };
  const [f, setF] = useState(blank);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ student: Student; payment?: Payment } | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const course = f.courseId ? db.courseById(f.courseId) : null;
  const batch = f.batchId ? db.batchById(f.batchId) : null;
  const fee = course?.fee ?? 0;
  const discount = Number(f.discount || 0);
  const net = Math.max(0, fee - discount);
  const initial = Number(f.initial || 0);
  const balance = Math.max(0, net - initial);
  const per = f.installments ? Math.floor(balance / f.installments / 50) * 50 : 0;
  const nextId = nextStudentId();
  const seats = batch ? batch.capacity - enrolledIn(batch.id) : 0;

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
    if (!f.batchId) e.batchId = 'Select a batch';
    if (balance > 0 && (!Number.isInteger(f.installments) || f.installments < 1 || f.installments > 8)) e.installments = 'Choose 1 to 8 installments';
    if (balance > 0 && (!f.firstDue || Number.isNaN(new Date(f.firstDue).getTime()))) e.firstDue = 'Choose a valid due date';
    if (discount > fee) e.discount = 'Discount can’t exceed the course fee';
    if (initial > net) e.initial = `Can’t exceed net fee of ${money(net)}`;
    return e;
  }, [f, discount, fee, initial, net]);
  const err = (k: string) => (submitted ? errors[k] : undefined);

  const schedule = useMemo(() => {
    const rows: { no: number; due: Date; amount: number }[] = [];
    let alloc = 0;
    for (let k = 1; k <= f.installments; k++) {
      const amt = k === f.installments ? balance - alloc : per;
      alloc += amt;
      const d = addMonthsClamped(new Date(f.firstDue), k - 1);
      rows.push({ no: k, due: d, amount: amt });
    }
    return rows;
  }, [f.installments, f.firstDue, balance, per]);

  const submit = () => {
    setSubmitted(true);
    if (Object.keys(errors).length) {
      toast('error', 'Please fix the highlighted fields', `${Object.keys(errors).length} field(s) need attention`);
      document.querySelector('.has-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setBusy(true);
    setTimeout(() => {
      try {
        const res = admitStudent(
          {
            name: f.name.trim(), fatherName: f.fatherName.trim(), gender: f.gender, dob: new Date(f.dob), phone: f.phone.replace(/\D/g, '').replace(/(\d{5})(\d{5})/, '$1 $2'),
            email: f.email, address: f.address, aadhaar: f.aadhaar, courseId: f.courseId, subtypeId: f.subtypeId, enquiryId: enquiry?.id, batchId: f.batchId, courseFee: fee, discount,
            initial, installments: balance > 0 ? f.installments : 0, firstDue: new Date(f.firstDue), mode: f.mode,
          },
          user.id,
        );
        setDone(res);
      } catch (error) {
        toast('error', error instanceof Error ? error.message : 'Admission could not be saved');
      } finally {
        setBusy(false);
      }
    }, 900);
  };

  return (
    <>
      <PageHeader title="Confirm admission" sub={enquiry ? `From enquiry ${enquiry.id}. Complete the remaining details and save admission.` : 'Open an enquiry to confirm admission.'} crumbs={[['Enquiries', '/enquiries'], ['Confirm admission']]} />
      {!enquiry && <div className="callout warning" style={{ marginBottom: 16 }}><Info /> <span>Select an enquiry first. <Link to="/enquiries">Open enquiries</Link></span></div>}

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
              <div className="row" style={{ gap: 18, marginBottom: 18, alignItems: 'center' }}>
                {f.name.trim() ? (
                  <Avatar name={f.name} size="xl" />
                ) : (
                  <span className="avatar xl" style={{ background: 'var(--surface-3)', color: 'var(--ink-3)' }}>
                    <Camera size={26} />
                  </span>
                )}
                <div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => toast('info', 'Photo upload', 'Opens camera / file picker (JPG or PNG, max 2 MB).')}>
                    <Camera /> Upload photo
                  </button>
                  <p className="field__hint" style={{ marginTop: 6 }}>
                    Optional · JPG or PNG up to 2 MB
                  </p>
                </div>
              </div>
              <div className="form-grid">
                <Field label="Student full name" required error={err('name')} htmlFor="name">
                  <input id="name" className="input" value={f.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" />
                </Field>
                <Field label="Father’s / guardian’s name" required error={err('fatherName')} htmlFor="fname">
                  <input id="fname" className="input" value={f.fatherName} onChange={(e) => set('fatherName', e.target.value)} />
                </Field>
                <Field label="Date of birth" required error={err('dob')} htmlFor="dob">
                  <input id="dob" type="date" className="input" value={f.dob} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set('dob', e.target.value)} />
                </Field>
                <div className="field">
                  <span className="field__label">
                    Gender <span className="req">*</span>
                  </span>
                  <Segmented
                    block
                    value={f.gender}
                    onChange={(v) => set('gender', v)}
                    options={[
                      { value: 'Male', label: 'Male' },
                      { value: 'Female', label: 'Female' },
                    ]}
                  />
                </div>
                <Field label="Mobile number" required error={err('phone')} hint="Used for receipts and WhatsApp reminders" htmlFor="ph">
                  <div className="input-group">
                    <span className="input-prefix" style={{ fontSize: 13 }}>
                      +91
                    </span>
                    <input id="ph" className="input num" style={{ paddingLeft: 44 }} inputMode="numeric" maxLength={11} value={f.phone} onChange={(e) => set('phone', e.target.value.replace(/[^\d ]/g, ''))} />
                  </div>
                </Field>
                <Field label="WhatsApp number" error={err('whatsapp')} htmlFor="wa">
                  <input id="wa" className="input num" inputMode="numeric" disabled={f.sameWa} value={f.sameWa ? f.phone : f.whatsapp} onChange={(e) => set('whatsapp', e.target.value.replace(/[^\d ]/g, ''))} />
                  <label className="check" style={{ marginTop: 2 }}>
                    <input type="checkbox" checked={f.sameWa} onChange={(e) => set('sameWa', e.target.checked)} /> Same as mobile
                  </label>
                </Field>
                <Field label="Email" error={err('email')} htmlFor="em">
                  <input id="em" type="email" className="input" value={f.email} onChange={(e) => set('email', e.target.value)} />
                </Field>
                <Field label="Aadhaar number" error={err('aadhaar')} hint="Optional · stored securely, never shown in lists" htmlFor="ad">
                  <input id="ad" className="input num" inputMode="numeric" maxLength={14} value={f.aadhaar} onChange={(e) => set('aadhaar', e.target.value.replace(/[^\d]/g, '').replace(/(\d{4})(?=\d)/g, '$1 '))} />
                </Field>
                <Field label="Address" required error={err('address')} className="span-2" htmlFor="addr">
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
                <Field label="Course" required error={err('courseId')} htmlFor="course" hint={course ? `${course.duration} months · ${money(course.fee)} · ${course.description}` : undefined}>
                  <select id="course" className="select" value={f.courseId} onChange={(e) => setF((x) => ({ ...x, courseId: e.target.value, subtypeId: '', batchId: '' }))}>
                    <option value="">Select course…</option>
                    {db.courses.filter((c) => c.active).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Course sub-type" htmlFor="subtype">
                  <select id="subtype" className="select" value={f.subtypeId} disabled={!f.courseId} onChange={(e) => set('subtypeId', e.target.value)}>
                    <option value="">None</option>
                    {db.courseSubtypes.filter((s) => s.courseId === f.courseId && s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
                <Field label="Batch" required error={err('batchId')} htmlFor="batch" hint={batch ? `${batch.timing} · ${batch.days} · ${batch.teacher}` : !f.courseId ? 'Choose a course first' : undefined}>
                  <select id="batch" className="select" value={f.batchId} disabled={!f.courseId} onChange={(e) => set('batchId', e.target.value)}>
                    <option value="">Select batch…</option>
                    {db.batches.filter((b) => b.courseId === f.courseId && b.status !== 'Completed').map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} · {b.timing} · {b.capacity - enrolledIn(b.id)} seats left
                      </option>
                    ))}
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
                <Field label="Discount" error={err('discount')} htmlFor="disc">
                  <MoneyInput id="disc" value={f.discount} onChange={(v) => set('discount', v)} />
                </Field>
                <Field label="Paid now" error={err('initial')} hint="Receipt is generated automatically" htmlFor="init">
                  <MoneyInput id="init" value={f.initial} onChange={(v) => set('initial', v)} />
                </Field>
                {initial > 0 && (
                  <div className="field span-2" style={{ gridColumn: '1 / -1' }}>
                    <span className="field__label">Payment mode</span>
                    <PayModePicker dense value={f.mode} onChange={(v) => set('mode', v)} />
                  </div>
                )}
                <Field label="Number of installments" error={err('installments')} htmlFor="inst">
                  <select id="inst" className="select" value={f.installments} onChange={(e) => set('installments', Number(e.target.value))} disabled={balance === 0}>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? 'installment' : 'installments'}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="First due date" error={err('firstDue')} htmlFor="fd">
                  <input id="fd" type="date" className="input" value={f.firstDue} onChange={(e) => set('firstDue', e.target.value)} disabled={balance === 0} />
                </Field>
              </div>
            </section>
          </div>
        </div>

        <aside className="sticky-side stack">
          <section className="panel">
            <div className="panel__head">
              <div>
                <h2>Admission summary</h2>
                <p>
                  Student ID <span className="id num" style={{ fontWeight: 700, color: 'var(--ink)' }}>{nextId}</span> (auto)
                </p>
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
                <div className="kv">
                  <span>Course fee</span>
                  <strong className="num">{money(fee)}</strong>
                </div>
                <div className="kv">
                  <span>Discount</span>
                  <strong className="num">− {money(discount)}</strong>
                </div>
                <div className="kv">
                  <span>Net fee</span>
                  <strong className="num">{money(net)}</strong>
                </div>
                <div className="kv">
                  <span>Paid now {initial > 0 && `(${f.mode})`}</span>
                  <strong className="num" style={{ color: 'var(--success-700)' }}>
                    {money(initial)}
                  </strong>
                </div>
                <div className="kv total">
                  <span>Balance</span>
                  <strong className="num">{money(balance)}</strong>
                </div>
              </div>
              {balance > 0 && fee > 0 && (
                <>
                  <div className="row-between" style={{ margin: '16px 0 8px' }}>
                    <h3 style={{ fontSize: 13 }}>Installment schedule</h3>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {f.installments} × ~{money(per)}
                    </span>
                  </div>
                  <div className="timeline">
                    {schedule.map((r) => (
                      <div className="tl-item" key={r.no} style={{ paddingBottom: 10 }}>
                        <span className="tl-item__dot primary" style={{ fontSize: 9, fontWeight: 700 }}>
                          {r.no}
                        </span>
                        <div className="row-between">
                          <span style={{ fontSize: 13 }}>{date(r.due)}</span>
                          <strong className="num" style={{ fontSize: 13 }}>
                            {money(r.amount)}
                          </strong>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="panel__foot" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <button className="btn btn-primary btn-lg btn-block" onClick={submit} disabled={busy || !enquiry || enquiry.status === 'Converted'}>
                {busy ? <span className="spinner" /> : <Save />}
                {busy ? 'Saving admission…' : 'Save admission'}
              </button>
              <Link to="/students" className="btn btn-ghost btn-block">
                Cancel
              </Link>
            </div>
          </section>
          <div className="callout info">
            <Info />
            <span>Student ID and receipt number are generated when you save in this demo session.</span>
          </div>
        </aside>
      </div>

      <Modal open={!!done} onClose={() => nav(`/students/${done?.student.id}`)}>
        {done && (
          <>
            <div className="modal__head">
              <div className="modal__icon success">
                <CheckCircle2 />
              </div>
              <div>
                <h2>Admission saved</h2>
                <p>
                  <strong>{done.student.name}</strong> is enrolled in {db.courseById(done.student.courseId).code} · {db.batchById(done.student.batchId).name}.
                </p>
              </div>
            </div>
            <div className="modal__body">
              <div className="summary-box">
                <div className="kv">
                  <span>Student ID</span>
                  <strong className="id">{done.student.id}</strong>
                </div>
                {done.payment && (
                  <div className="kv">
                    <span>Receipt</span>
                    <strong className="id">
                      {done.payment.receiptNo} · {money(done.payment.amount)}
                    </strong>
                  </div>
                )}
                <div className="kv">
                  <span>Balance</span>
                  <strong>{money(balance)}</strong>
                </div>
              </div>
            </div>
            <div className="modal__foot">
              <button className="btn btn-secondary" onClick={() => {
                  setDone(null);
                  setSubmitted(false);
                  setF(blank);
                  window.scrollTo({ top: 0 });
                }}>
                <UserPlus /> Another admission
              </button>
              {done.payment && (
                <Link className="btn btn-secondary" to={`/fees/receipts/${done.payment.receiptNo}`}>
                  <Printer /> Print receipt
                </Link>
              )}
              <Link className="btn btn-primary" to={`/students/${done.student.id}`}>
                View profile
              </Link>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
