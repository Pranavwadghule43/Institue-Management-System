import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Plus, Search } from 'lucide-react';
import { errText, useApp } from '../../app/AppContext';
import { Empty, Field, LoadError, PageHeader, Pagination, Panel, SkeletonRows, pager, useDebounced, usePage } from '../../components/ui';
import { api, useQuery, write, type Page } from '../../api/client';
import type { Course, Enquiry, EnquiryActivity, EnquiryStatus } from '../../api/types';
import { SubtypeChecks } from '../../components/SubtypeChecks';
import { dateTime } from '../../lib/format';
import NotFound from '../NotFound';

const STATUSES: EnquiryStatus[] = ['New', 'Pending', 'Follow-Up', 'Converted'];
interface Summary { total: number; by_status: Record<EnquiryStatus, number>; confirmed_admissions: number; by_staff: { staff_id: number; name: string; count: number }[] }

export function EnquiryDashboard() {
  const { can } = useApp();
  const [status, setStatus] = useState<EnquiryStatus | ''>('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useDebounced(query);
  const [page, setPage] = usePage([status, q, from, to]);
  const { data: sum } = useQuery<Summary>('/enquiries/summary');
  const { data, error, loading, reload } = useQuery<Page<Enquiry>>('/enquiries', { status, q, created_from: from, created_to: to, page, page_size: 20 });

  return <>
    <PageHeader title="Enquiry dashboard" sub="Follow every enquiry from first contact to admission." crumbs={[["Students", "/students"], ["Enquiries"]]} actions={can('students.create') ? <Link className="btn btn-primary" to="/enquiries/new"><Plus /> New enquiry</Link> : undefined} />
    <div className="enquiry-kpis">
      <button className="panel" style={{ padding: 20, textAlign: 'left' }} onClick={() => setStatus('')}>Total enquiries<br /><strong>{sum?.total ?? '—'}</strong></button>
      {STATUSES.map((s) => <button className="panel" key={s} style={{ padding: 20, textAlign: 'left' }} onClick={() => setStatus(s)}>{`${s} enquiries`}<br /><strong>{sum?.by_status[s] ?? '—'}</strong></button>)}
      <button className="panel" style={{ padding: 20, textAlign: 'left' }} onClick={() => setStatus('Converted')}>Confirmed admissions<br /><strong>{sum?.confirmed_admissions ?? '—'}</strong></button>
    </div>
    <Panel title="Recent enquiries" sub="Each enquiry appears once in the list. Confirmed admissions are linked converted enquiries.">
      <div className="table-toolbar">
        <div className="input-group"><Search /><input className="input" aria-label="Search enquiries" placeholder="Name, phone or enquiry ID" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <select className="select" aria-label="Enquiry status" value={status} onChange={(e) => setStatus(e.target.value as EnquiryStatus | '')}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <input className="input" type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="input" type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {error ? <LoadError error={error} retry={reload} /> : loading ? <SkeletonRows rows={5} cols={6} /> : data!.items.length ? <>
        <div className="table-wrap"><table className="table"><thead><tr><th>Enquiry</th><th>Student</th><th>Course</th><th>Handled by</th><th>Status</th><th>Created</th><th /></tr></thead><tbody>{data!.items.map((e) => <tr key={e.code}><td className="id">{e.code}</td><td>{e.student_name}<div className="muted">{e.mobile}</div></td><td>{e.course?.name ?? 'Undecided'}{e.course_subtypes?.length ? <div className="muted" style={{ fontSize: 12 }}>{e.course_subtypes.map((x) => x.name).join(', ')}</div> : null}</td><td>{e.handling_staff?.name ?? '—'}</td><td>{e.status}</td><td>{dateTime(e.created_at)}</td><td><Link className="btn btn-ghost btn-sm" to={`/enquiries/${e.code}`}>Open</Link></td></tr>)}</tbody></table></div>
        <Pagination {...pager(data, setPage)} noun="enquiries" />
      </> : <Empty icon={<Search />} title="No enquiries found" body="Create an enquiry or change the filters." />}
    </Panel>
    <Panel title="Staff-wise enquiry distribution" sub="Current handling staff">
      {sum?.by_staff.map((s) => <div className="row-between" key={s.staff_id} style={{ padding: 8 }}><span>{s.name}</span><strong>{s.count}</strong></div>)}
      {sum && !sum.total && <p className="muted">No enquiries yet.</p>}
    </Panel>
  </>;
}

export function CourseSelect({ courseId, subtypeIds, onChange, idPrefix }: { courseId: string; subtypeIds: number[]; onChange: (courseId: string, subtypeIds: number[]) => void; idPrefix: string }) {
  const { data: courses } = useQuery<Course[]>('/courses', { active: true });
  return <>
    <Field label="Course" htmlFor={`${idPrefix}-course`}><select id={`${idPrefix}-course`} className="select" value={courseId} onChange={(e) => onChange(e.target.value, [])}><option value="">Undecided</option>{courses?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
    <SubtypeChecks courseId={courseId} value={subtypeIds} onChange={(ids) => onChange(courseId, ids)} />
  </>;
}

export function NewEnquiry() {
  const { toast } = useApp();
  const nav = useNavigate();
  const [form, setForm] = useState({ student_name: '', mobile: '', guardian_name: '', email: '', address: '', aadhaar: '', reference: '', course_id: '', course_subtype_ids: [] as number[] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const e = await write(api<Enquiry>('/enquiries', { method: 'POST', body: { ...form, course_id: form.course_id ? Number(form.course_id) : null, course_subtype_ids: form.course_id ? form.course_subtype_ids : [] } }));
      toast('success', 'Enquiry saved', e.code);
      nav(`/enquiries/${e.code}`);
    } catch (err) {
      setErrors((err as { fields?: Record<string, string> }).fields ?? {});
      setError(errText(err));
      setBusy(false);
    }
  };
  return <>
    <PageHeader title="New enquiry" sub="Save an enquiry before confirming admission. Aadhaar is optional." crumbs={[["Enquiries", "/enquiries"], ["New enquiry"]]} />
    <section className="panel"><div className="panel__body"><div className="form-grid">
      <Field label="Student name" required htmlFor="en-name" error={errors.student_name}><input id="en-name" className="input" value={form.student_name} onChange={(e) => set('student_name', e.target.value)} /></Field>
      <Field label="Mobile number" required htmlFor="en-phone" error={errors.mobile}><input id="en-phone" className="input" inputMode="numeric" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} /></Field>
      <Field label="Father / guardian name" htmlFor="en-father" error={errors.guardian_name}><input id="en-father" className="input" value={form.guardian_name} onChange={(e) => set('guardian_name', e.target.value)} /></Field>
      <Field label="Email" htmlFor="en-email" error={errors.email}><input id="en-email" className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
      <Field label="Address" htmlFor="en-address"><input id="en-address" className="input" value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
      <Field label="Reference" htmlFor="en-ref"><input id="en-ref" className="input" value={form.reference} onChange={(e) => set('reference', e.target.value)} /></Field>
      <Field label="Aadhaar number (optional)" htmlFor="en-aadhaar" error={errors.aadhaar}><input id="en-aadhaar" className="input" inputMode="numeric" value={form.aadhaar} onChange={(e) => set('aadhaar', e.target.value)} /></Field>
      <CourseSelect idPrefix="en" courseId={form.course_id} subtypeIds={form.course_subtype_ids} onChange={(c, s) => setForm((f) => ({ ...f, course_id: c, course_subtype_ids: s }))} />
    </div>{error && <p className="field__error" role="alert">{error}</p>}</div><div className="panel__foot"><Link className="btn btn-secondary" to="/enquiries">Cancel</Link><button className="btn btn-primary" disabled={busy} onClick={save}>{busy && <span className="spinner" />}Save enquiry</button></div></section>
  </>;
}

export function EnquiryDetail() {
  const { id } = useParams();
  const { can, toast } = useApp();
  const [status, setStatus] = useState<Exclude<EnquiryStatus, 'Converted'>>('Pending');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: enquiry, error, loading } = useQuery<Enquiry>(`/enquiries/${id}`);
  const { data: activity } = useQuery<EnquiryActivity[]>(`/enquiries/${id}/activities`);
  if (error?.status === 404) return <NotFound what="enquiry" />;
  if (error) return <LoadError error={error} />;
  if (loading || !enquiry) return <SkeletonRows rows={4} cols={3} />;
  const save = async () => {
    setBusy(true);
    try {
      await write(api(`/enquiries/${enquiry.code}/followups`, { method: 'POST', body: { status, note } }));
      setNote('');
      toast('success', 'Enquiry updated');
    } catch (err) {
      toast('error', errText(err));
    } finally {
      setBusy(false);
    }
  };
  return <>
    <PageHeader title={`${enquiry.student_name} · ${enquiry.code}`} sub={`Status: ${enquiry.status} · Handled by ${enquiry.handling_staff?.name ?? '—'}`} crumbs={[["Enquiries", "/enquiries"], [enquiry.code]]} actions={enquiry.student_code ? <Link className="btn btn-primary" to={`/students/${enquiry.student_code}`}><CheckCircle2 /> View student</Link> : can('students.create') ? <Link className="btn btn-primary" to={`/students/new?enquiry=${enquiry.code}`}>Confirm admission</Link> : undefined} />
    <div className="two-col"><Panel title="Enquiry details"><p><strong>Mobile:</strong> {enquiry.mobile}</p>{enquiry.guardian_name && <p><strong>Guardian:</strong> {enquiry.guardian_name}</p>}<p><strong>Course:</strong> {enquiry.course?.name ?? 'Undecided'}{enquiry.course_subtypes?.length ? ` · ${enquiry.course_subtypes.map((x) => x.name).join(', ')}` : ''}</p><p><strong>Reference:</strong> {enquiry.reference || '—'}</p>{enquiry.aadhaar_masked && <p><strong>Aadhaar:</strong> {enquiry.aadhaar_masked}</p>}<p><strong>Created:</strong> {dateTime(enquiry.created_at)}</p></Panel>
    <Panel title="Follow up"><div className="stack"><select className="select" aria-label="New status" value={status} onChange={(e) => setStatus(e.target.value as Exclude<EnquiryStatus, 'Converted'>)}>{(['New', 'Pending', 'Follow-Up'] as const).map((s) => <option key={s}>{s}</option>)}</select><textarea className="textarea" aria-label="Follow-up notes" placeholder="Follow-up notes" value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn btn-primary" disabled={busy || enquiry.status === 'Converted' || !can('students.create')} onClick={save}>{busy && <span className="spinner" />}Save update</button></div></Panel></div>
    <Panel title="Activity history">{activity?.map((a, i) => <div key={i} className="row-between" style={{ padding: 10, borderBottom: '1px solid var(--line)' }}><span><strong>{a.action}</strong> · {a.status}{a.note && <span className="muted"> · {a.note}</span>}</span><small>{a.by?.name ?? '—'} · {dateTime(a.at)}</small></div>)}</Panel>
  </>;
}
