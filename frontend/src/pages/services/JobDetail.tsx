import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Ban, Check, CheckCircle2, ChevronDown, Clock, Eye, FileText, FileUp, Loader2, Lock, MessageCircle, Phone, PauseCircle, ReceiptText, ShieldAlert, StickyNote, Trash2, UserRound,
} from 'lucide-react';
import { errText, useApp } from '../../app/AppContext';
import { Avatar, BillStatusBadge, Confirm, Field, JobStatusBadge, LoadError, Menu, PageHeader, Panel, SkeletonRows } from '../../components/ui';
import { api, download, useQuery, write } from '../../api/client';
import type { Job, JobDocument, JobEvent, JobStatus } from '../../api/types';
import { date, dateTime, money } from '../../lib/format';
import { INSTITUTE, waLink } from '../../lib/whatsapp';
import NotFound from '../NotFound';

const STATUS_ICON: Record<JobStatus, JSX.Element> = {
  Pending: <Clock />,
  'In Process': <Loader2 />,
  'On Hold': <PauseCircle />,
  Completed: <CheckCircle2 />,
  Cancelled: <Ban />,
};

/* WF-07 allowed transitions — Completed and Cancelled are final (the server enforces the same rule) */
const NEXT: Record<JobStatus, JobStatus[]> = {
  Pending: ['In Process', 'On Hold', 'Cancelled'],
  'In Process': ['Completed', 'On Hold', 'Cancelled'],
  'On Hold': ['In Process', 'Cancelled'],
  Completed: [],
  Cancelled: [],
};

export default function JobDetail() {
  const { id } = useParams();
  const { can, toast } = useApp();
  const nav = useNavigate();
  const [next, setNext] = useState<JobStatus | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [delDoc, setDelDoc] = useState<JobDocument | null>(null);
  const [docType, setDocType] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: j, error, loading } = useQuery<Job>(`/service-jobs/${id}`);
  const { data: events } = useQuery<JobEvent[]>(`/service-jobs/${id}/events`);
  const { data: docs } = useQuery<JobDocument[]>(`/service-jobs/${id}/documents`);
  if (error?.status === 404) return <NotFound what="service job" />;
  if (error) return <LoadError error={error} />;
  if (loading || !j) return <SkeletonRows rows={6} cols={4} />;
  const c = j.customer;
  const bill = j.bill;
  const options = NEXT[j.status];
  const steps = (() => {
    const order = ['Pending', 'In Process', 'Completed'];
    const idx = j.status === 'On Hold' ? 1 : order.indexOf(j.status);
    return [
      { label: 'Received', done: true, current: false },
      { label: j.status === 'On Hold' ? 'On hold' : 'In process', done: idx > 1 || j.status === 'Completed', current: idx === 1 },
      { label: j.status === 'Cancelled' ? 'Cancelled' : 'Completed', done: j.status === 'Completed', current: j.status === 'Cancelled' },
      { label: 'Billed & paid', done: bill?.status === 'Paid', current: j.status === 'Completed' && bill?.status !== 'Paid' },
    ];
  })();

  const upload = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    if (docType.trim()) fd.append('document_type', docType.trim());
    try {
      await write(api(`/service-jobs/${j.code}/documents`, { method: 'POST', body: fd }));
      setDocType('');
      toast('success', 'Document uploaded', file.name);
    } catch (e) {
      toast('error', errText(e));
    }
  };

  return (
    <>
      <PageHeader
        title={<span className="row" style={{ gap: 10, flexWrap: 'wrap' }}>{j.services[0]?.name}<JobStatusBadge s={j.status} /></span>}
        sub={<><span className="id">{j.code}</span> · {c.name}{j.application_name && ` · ${j.application_name}`}</>}
        crumbs={[['Services'], ['Service jobs', '/services/jobs'], [j.code]]}
        actions={
          <>
            <a className="btn btn-whatsapp" href={waLink(c.whatsapp_number, `Dear ${c.name}, update on your ${j.services[0]?.name} request (${j.code}): status is now "${j.status}". — ${INSTITUTE}`)} target="_blank" rel="noreferrer">
              <MessageCircle /> Update customer
            </a>
            {can('service_jobs.status') && options.length > 0 && (
              <Menu trigger={<button className="btn btn-primary">Change status <ChevronDown /></button>}>
                <div className="menu__label">Move job to</div>
                {options.map((s) => (
                  <button key={s} className={`menu__item ${s === 'Cancelled' ? 'danger' : ''}`} onClick={() => { setNext(s); setNote(''); }}>
                    {STATUS_ICON[s]} {s}
                  </button>
                ))}
              </Menu>
            )}
          </>
        }
      />

      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="stepper" style={{ borderTop: 0 }}>
          {steps.map((s, i) => (
            <span key={s.label} className="row" style={{ flex: i < steps.length - 1 ? 1 : undefined, gap: 0 }}>
              <span className={`step ${s.done ? 'done' : s.current ? 'current' : ''}`}><span className="n">{s.done ? <Check /> : i + 1}</span>{s.label}</span>
              {i < steps.length - 1 && <span className={`step-line ${s.done ? 'done' : ''}`} />}
            </span>
          ))}
        </div>
      </section>

      <div className="two-col">
        <div className="stack">
          <Panel title="Services" flush>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Service</th><th>Category</th><th className="ta-r">Rate at intake</th></tr></thead>
                <tbody>
                  {j.services.map((s) => (
                    <tr key={s.id}><td style={{ fontWeight: 600 }}>{s.name}</td><td className="muted">{s.category}</td><td className="ta-r num">{money(s.rate)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            title="Documents"
            sub={docs?.length ? `${docs.length} file${docs.length > 1 ? 's' : ''} · private, opened only through the app` : 'No documents on this job'}
            actions={can('service_documents.upload') ? (
              <>
                <input className="input" style={{ width: 170, height: 32 }} placeholder="Type (e.g. PAN Card)" value={docType} onChange={(e) => setDocType(e.target.value)} aria-label="Document type" list="doc-types" title="Unknown or blank types are visible only to staff allowed to view sensitive documents" />
                <datalist id="doc-types">{['PAN Card', 'Bank Passbook', 'Form 16', 'Passport', 'Driving Licence', 'Voter ID', 'Passport Photo', 'Signature', 'Application Form', 'Receipt'].map((t) => <option key={t} value={t} />)}</datalist>
                <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}><FileUp /> Upload</button>
                <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
              </>
            ) : undefined}
          >
            {docs && docs.length === 0 && <p className="muted" style={{ fontSize: 13 }}>PDF, JPG or PNG up to 5 MB.</p>}
            {docs?.map((d) => (
              <div className="doc-row" key={d.id}>
                <span className="doc-ico ok"><FileText /></span>
                <div className="doc-row__meta">
                  <strong>
                    {d.document_type || d.original_name}
                    {d.sensitive && <span className="tag" title="Sensitive identity document"><ShieldAlert /> Sensitive</span>}
                  </strong>
                  <span>{d.original_name} · {Math.round(d.size_bytes / 1024)} KB · {d.uploaded_by?.name} · {date(d.created_at)}</span>
                </div>
                {d.can_view ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => download(`/service-jobs/${j.code}/documents/${d.id}`, undefined, true).catch((e) => toast('error', errText(e)))}>
                    <Eye /> View
                  </button>
                ) : (
                  <span className="lock-note" title="Ask the Admin for access"><Lock /> Restricted</span>
                )}
                {can('service_documents.delete') && (
                  <button className="icon-btn sm danger" aria-label="Delete document" onClick={() => setDelDoc(d)}><Trash2 /></button>
                )}
              </div>
            ))}
          </Panel>

          <Panel title="Status history">
            <div className="timeline">
              {events?.map((h, i) => (
                <div className="tl-item" key={i}>
                  <span className={`tl-item__dot ${h.status === 'Completed' ? 'success' : h.status === 'Cancelled' ? 'danger' : h.status === 'In Process' ? 'info' : h.status === 'On Hold' ? 'warning' : 'primary'}`}>
                    {h.status && h.status in STATUS_ICON ? STATUS_ICON[h.status as JobStatus] : h.type === 'Document' ? <FileUp /> : <StickyNote />}
                  </span>
                  <div className="tl-item__title">{h.type === 'Created' ? 'Job created' : h.type === 'Status' ? `Moved to ${h.status}` : h.type === 'Assigned' ? 'Assignment changed' : h.type === 'Document' ? 'Document' : 'Updated'}</div>
                  <div className="tl-item__meta">{dateTime(h.at)} · {h.by?.name ?? 'System'}</div>
                  {h.note && <div className="tl-item__note">{h.note}</div>}
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <aside className="stack">
          <Panel title="Customer" actions={can('customers.view') ? <Link to={`/services/customers/${c.code}`} className="btn btn-ghost btn-sm">Profile</Link> : undefined}>
            <div className="person" style={{ marginBottom: 14 }}>
              <Avatar name={c.name} size="lg" />
              <div className="person__meta"><strong style={{ fontSize: 15 }}>{c.name}</strong><span>{c.code}</span></div>
            </div>
            <dl className="kv-list">
              <dt>Mobile</dt>
              <dd className="num"><a href={`tel:${c.mobile}`}><Phone size={12} /> {c.mobile}</a></dd>
              <dt>WhatsApp</dt>
              <dd className="num">{c.whatsapp_number}</dd>
            </dl>
          </Panel>

          <Panel title="Job details">
            <dl className="kv-list">
              <dt>Service date</dt>
              <dd>{date(j.service_date)}</dd>
              {j.application_name && (<><dt>Form</dt><dd>{j.application_name}</dd></>)}
              {j.notes && (<><dt>Notes</dt><dd>{j.notes}</dd></>)}
            </dl>
            <hr className="divider" />
            <div className="field__label" style={{ marginBottom: 8 }}>Assigned staff</div>
            {j.assignees.map((a) => (
              <div key={a.id} className="person" style={{ marginBottom: 8 }}>
                <Avatar name={a.name} size="sm" />
                <div className="person__meta"><strong style={{ fontSize: 13 }}>{a.name}</strong></div>
              </div>
            ))}
            {!j.assignees.length && <p className="muted" style={{ fontSize: 13 }}>Nobody assigned.</p>}
          </Panel>

          <Panel title="Billing" icon={<ReceiptText />}>
            {bill ? (
              <>
                <div className="row-between" style={{ marginBottom: 12 }}><span className="id">{bill.code}</span><BillStatusBadge s={bill.status} /></div>
                <div className="row-between" style={{ marginBottom: 14 }}><span className="muted">Grand total</span><strong className="num" style={{ fontSize: 20 }}>{money(bill.grand_total)}</strong></div>
                <Link to={`/services/bills/${bill.code}`} className="btn btn-secondary btn-block">{bill.status === 'Unpaid' ? 'Open bill & collect payment' : 'View bill'}</Link>
              </>
            ) : (
              <>
                <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>No bill yet. Estimated amount <strong className="num" style={{ color: 'var(--ink)' }}>{money(j.estimate)}</strong> from Service Master rates.</p>
                {can('service_bill.create') && j.status !== 'Cancelled' && (
                  <button className="btn btn-primary btn-block" onClick={() => nav(`/services/bills/new?job=${j.code}`)}><ReceiptText /> Create bill</button>
                )}
              </>
            )}
          </Panel>
        </aside>
      </div>

      <Confirm
        open={!!next}
        onClose={() => setNext(null)}
        tone={next === 'Cancelled' ? 'danger' : 'primary'}
        icon={next ? STATUS_ICON[next] : <UserRound />}
        title={`Move ${j.code} to ${next}?`}
        body={next === 'Cancelled' ? 'Cancelled jobs are excluded from pending lists. Any unpaid bill should be cancelled by an Admin.' : `Current status: ${j.status}. The change is recorded in the status history.`}
        confirmLabel={`Mark ${next}`}
        busy={busy}
        disabled={(next === 'Cancelled' || next === 'On Hold') && note.trim().length < 3}
        onConfirm={async () => {
          setBusy(true);
          try {
            await write(api(`/service-jobs/${j.code}/status`, { method: 'POST', body: { status: next, reason: note || null } }));
            toast('success', `${j.code} marked ${next}`);
            setNext(null);
          } catch (e) {
            toast('error', errText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={next === 'Cancelled' || next === 'On Hold' ? 'Reason' : 'Note (optional)'} required={next === 'Cancelled' || next === 'On Hold'} htmlFor="sn">
          <textarea id="sn" className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={next === 'Completed' ? 'e.g. Acknowledgement slip handed over' : ''} />
        </Field>
      </Confirm>

      <Confirm
        open={!!delDoc}
        onClose={() => setDelDoc(null)}
        tone="danger"
        icon={<Trash2 />}
        title={`Delete ${delDoc?.original_name}?`}
        body="The document is hidden from the job. The deletion is recorded in the audit log."
        confirmLabel="Delete document"
        onConfirm={async () => {
          try {
            await write(api(`/service-jobs/${j.code}/documents/${delDoc!.id}`, { method: 'DELETE' }));
            toast('success', 'Document deleted');
          } catch (e) {
            toast('error', errText(e));
          }
          setDelDoc(null);
        }}
      />
    </>
  );
}
