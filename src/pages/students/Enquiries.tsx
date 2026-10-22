import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Plus, Search } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { Empty, Field, PageHeader, Panel } from '../../components/ui';
import { createEnquiry, db, updateEnquiry, useStore } from '../../data/store';
import type { EnquiryStatus } from '../../data/types';
import { dateTime } from '../../lib/format';

export function EnquiryDashboard() {
  useStore();
  const { can } = useApp();
  const [status, setStatus] = useState<EnquiryStatus | ''>('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const statuses: EnquiryStatus[] = ['New', 'Pending', 'Follow-Up', 'Converted'];
  const rows = db.enquiries.filter((e) =>
    (!status || e.status === status) &&
    (!query || `${e.id} ${e.name} ${e.phone}`.toLowerCase().includes(query.toLowerCase())) &&
    (!from || e.createdAt >= new Date(`${from}T00:00:00`)) &&
    (!to || e.createdAt <= new Date(`${to}T23:59:59`))
  );
  return <>
    <PageHeader title="Enquiry dashboard" sub="Follow every enquiry from first contact to admission." crumbs={[["Students", "/students"], ["Enquiries"]]} actions={can('students.create') ? <Link className="btn btn-primary" to="/enquiries/new"><Plus /> New enquiry</Link> : undefined} />
    <div className="enquiry-kpis">
      <button className="panel" style={{ padding: 20, textAlign: 'left' }} onClick={() => setStatus('')}>Total enquiries<br /><strong>{db.enquiries.length}</strong></button>
      {statuses.map((s) => <button className="panel" key={s} style={{ padding: 20, textAlign: 'left' }} onClick={() => setStatus(s)}>{`${s} enquiries`}<br /><strong>{db.enquiries.filter((e) => e.status === s).length}</strong></button>)}
      <button className="panel" style={{ padding: 20, textAlign: 'left' }} onClick={() => setStatus('Converted')}>Confirmed admissions<br /><strong>{db.enquiries.filter((e) => e.studentId).length}</strong></button>
    </div>
    <Panel title="Recent enquiries" sub="Each enquiry appears once in the list. Confirmed admissions are linked converted enquiries.">
      <div className="table-toolbar">
        <div className="input-group"><Search /><input className="input" aria-label="Search enquiries" placeholder="Name, phone or enquiry ID" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <select className="select" aria-label="Enquiry status" value={status} onChange={(e) => setStatus(e.target.value as EnquiryStatus | '')}><option value="">All statuses</option>{statuses.map((s) => <option key={s}>{s}</option>)}</select>
        <input className="input" type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="input" type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {rows.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Enquiry</th><th>Student</th><th>Course</th><th>Handled by</th><th>Status</th><th>Created</th><th /></tr></thead><tbody>{rows.map((e) => <tr key={e.id}><td className="id">{e.id}</td><td>{e.name}<div className="muted">{e.phone}</div></td><td>{db.courses.find((c) => c.id === e.courseId)?.name ?? 'Undecided'}</td><td>{db.staff.find((s) => s.id === e.handledBy)?.name ?? 'Unknown'}</td><td>{e.status}</td><td>{dateTime(e.createdAt)}</td><td><Link className="btn btn-ghost btn-sm" to={`/enquiries/${e.id}`}>Open</Link></td></tr>)}</tbody></table></div> : <Empty icon={<Search />} title="No enquiries found" body="Create an enquiry or change the filters." />}
    </Panel>
    <Panel title="Staff-wise enquiry distribution" sub="Current handling staff">
      {db.staff.filter((s) => db.enquiries.some((e) => e.handledBy === s.id)).map((s) => <div className="row-between" key={s.id} style={{ padding: 8 }}><span>{s.name}</span><strong>{db.enquiries.filter((e) => e.handledBy === s.id).length}</strong></div>)}
      {!db.enquiries.length && <p className="muted">No enquiries yet.</p>}
    </Panel>
  </>;
}

export function NewEnquiry() {
  const { user, toast } = useApp();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', phone: '', fatherName: '', email: '', address: '', aadhaar: '', reference: '', courseId: '', subtypeId: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));
  return <>
    <PageHeader title="New enquiry" sub="Save an enquiry before confirming admission. Aadhaar is optional." crumbs={[["Enquiries", "/enquiries"], ["New enquiry"]]} />
    <section className="panel"><div className="panel__body"><div className="form-grid">
      <Field label="Student name" required htmlFor="en-name"><input id="en-name" className="input" value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
      <Field label="Mobile number" required htmlFor="en-phone"><input id="en-phone" className="input" inputMode="numeric" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
      <Field label="Father / guardian name" htmlFor="en-father"><input id="en-father" className="input" value={form.fatherName} onChange={(e) => set('fatherName', e.target.value)} /></Field>
      <Field label="Email" htmlFor="en-email"><input id="en-email" className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
      <Field label="Address" htmlFor="en-address"><input id="en-address" className="input" value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
      <Field label="Reference" htmlFor="en-ref"><input id="en-ref" className="input" value={form.reference} onChange={(e) => set('reference', e.target.value)} /></Field>
      <Field label="Aadhaar number (optional)" htmlFor="en-aadhaar"><input id="en-aadhaar" className="input" inputMode="numeric" value={form.aadhaar} onChange={(e) => set('aadhaar', e.target.value)} /></Field>
      <Field label="Course" htmlFor="en-course"><select id="en-course" className="select" value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value, subtypeId: '' })}><option value="">Undecided</option>{db.courses.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      {form.courseId && <Field label="Course sub-type" htmlFor="en-sub"><select id="en-sub" className="select" value={form.subtypeId} onChange={(e) => set('subtypeId', e.target.value)}><option value="">None</option>{db.courseSubtypes.filter((s) => s.courseId === form.courseId && s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
    </div>{error && <p className="field__error" role="alert">{error}</p>}</div><div className="panel__foot"><Link className="btn btn-secondary" to="/enquiries">Cancel</Link><button className="btn btn-primary" disabled={busy} onClick={() => { if (busy) return; setBusy(true); try { const e = createEnquiry({ ...form, name: form.name.trim(), phone: form.phone.replace(/\D/g, '') }, user.id); toast('success', 'Enquiry saved', e.id); nav(`/enquiries/${e.id}`); } catch (err) { setError(err instanceof Error ? err.message : 'Could not save enquiry'); setBusy(false); } }}>Save enquiry</button></div></section>
  </>;
}

export function EnquiryDetail() {
  useStore();
  const { id } = useParams();
  const { can, user, toast } = useApp();
  const [status, setStatus] = useState<Exclude<EnquiryStatus, 'Converted'>>('Pending');
  const [note, setNote] = useState('');
  const enquiry = db.enquiries.find((e) => e.id === id);
  if (!enquiry) return <Empty icon={<Search />} title="Enquiry not found" body="Return to the enquiry dashboard." action={<Link to="/enquiries" className="btn btn-secondary">Enquiries</Link>} />;
  return <>
    <PageHeader title={`${enquiry.name} · ${enquiry.id}`} sub={`Status: ${enquiry.status} · Handled by ${db.staff.find((s) => s.id === enquiry.handledBy)?.name ?? 'Unknown'}`} crumbs={[["Enquiries", "/enquiries"], [enquiry.id]]} actions={enquiry.studentId ? <Link className="btn btn-primary" to={`/students/${enquiry.studentId}`}><CheckCircle2 /> View student</Link> : can('students.create') ? <Link className="btn btn-primary" to={`/students/new?enquiry=${enquiry.id}`}>Confirm admission</Link> : undefined} />
    <div className="two-col"><Panel title="Enquiry details"><p><strong>Mobile:</strong> {enquiry.phone}</p><p><strong>Course:</strong> {db.courses.find((c) => c.id === enquiry.courseId)?.name ?? 'Undecided'}</p><p><strong>Reference:</strong> {enquiry.reference || '—'}</p><p><strong>Created:</strong> {dateTime(enquiry.createdAt)}</p></Panel>
    <Panel title="Follow up"><div className="stack"><select className="select" aria-label="New status" value={status} onChange={(e) => setStatus(e.target.value as Exclude<EnquiryStatus, 'Converted'>)}>{(['New', 'Pending', 'Follow-Up'] as const).map((s) => <option key={s}>{s}</option>)}</select><textarea className="textarea" aria-label="Follow-up notes" placeholder="Follow-up notes" value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn btn-primary" disabled={enquiry.status === 'Converted' || !can('students.create')} onClick={() => { try { updateEnquiry(enquiry.id, status, note, user.id); setNote(''); toast('success', 'Enquiry updated'); } catch (err) { toast('error', err instanceof Error ? err.message : 'Update failed'); } }}>Save update</button></div></Panel></div>
    <Panel title="Activity history">{[...enquiry.activity].reverse().map((a, i) => <div key={i} className="row-between" style={{ padding: 10, borderBottom: '1px solid var(--line)' }}><span><strong>{a.action}</strong> · {a.status}{a.note && <span className="muted"> · {a.note}</span>}</span><small>{db.staff.find((s) => s.id === a.by)?.name ?? 'Unknown'} · {dateTime(a.at)}</small></div>)}</Panel>
  </>;
}
