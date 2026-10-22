import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Ban, Check, CheckCircle2, ChevronDown, Clock, Eye, FileText, FileUp, Loader2, Lock, MessageCircle, Phone, PauseCircle, ReceiptText, ShieldAlert, StickyNote, UserRound,
} from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { Avatar, BillStatusBadge, Confirm, Field, JobStatusBadge, Menu, PageHeader, Panel } from '../../components/ui';
import { customerJobs, db, setJobStatus, useStore } from '../../data/store';
import type { JobStatus } from '../../data/types';
import { date, dateTime, money } from '../../lib/format';
import { waLink } from '../../lib/whatsapp';
import { DueLabel } from './Jobs';
import NotFound from '../NotFound';

const STATUS_ICON: Record<JobStatus, JSX.Element> = {
  Pending: <Clock />,
  'In Process': <Loader2 />,
  'On Hold': <PauseCircle />,
  Completed: <CheckCircle2 />,
  Cancelled: <Ban />,
};

/* WF-07 allowed transitions — Completed and Cancelled are final */
const NEXT: Record<JobStatus, JobStatus[]> = {
  Pending: ['In Process', 'On Hold', 'Cancelled'],
  'In Process': ['Completed', 'On Hold', 'Cancelled'],
  'On Hold': ['In Process', 'Cancelled'],
  Completed: [],
  Cancelled: [],
};

export default function JobDetail() {
  useStore();
  const { id } = useParams();
  const { can, user, toast } = useApp();
  const nav = useNavigate();
  const [next, setNext] = useState<JobStatus | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const j = db.jobs.find((x) => x.id === id);
  if (!j) return <NotFound what="service job" />;
  const c = db.customerById(j.customerId);
  const bill = j.billId ? db.billById(j.billId) : null;
  const est = j.serviceIds.reduce((t, s) => t + db.serviceById(s).price, 0);
  const up = j.docs.filter((d) => d.uploaded).length;
  const canSensitive = can('service_documents.view_sensitive');

  const steps: { label: string; done: boolean; current: boolean }[] = (() => {
    const order = ['Pending', 'In Process', 'Completed'];
    const idx = j.status === 'On Hold' ? 1 : order.indexOf(j.status);
    return [
      { label: 'Received', done: true, current: false },
      { label: j.status === 'On Hold' ? 'On hold' : 'In process', done: idx > 1 || j.status === 'Completed', current: idx === 1 },
      { label: j.status === 'Cancelled' ? 'Cancelled' : 'Completed', done: j.status === 'Completed', current: j.status === 'Cancelled' },
      { label: 'Billed & paid', done: bill?.status === 'Paid', current: j.status === 'Completed' && bill?.status !== 'Paid' },
    ];
  })();

  const options: JobStatus[] = NEXT[j.status];

  return (
    <>
      <PageHeader
        title={
          <span className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {db.serviceById(j.serviceIds[0]).name}
            <JobStatusBadge s={j.status} />
          </span>
        }
        sub={
          <>
            <span className="id">{j.id}</span> · {c.name}
            {j.formName && ` · ${j.formName}`}
          </>
        }
        crumbs={[['Services'], ['Service jobs', '/services/jobs'], [j.id]]}
        actions={
          <>
            <a className="btn btn-whatsapp" href={waLink(c.whatsapp, `Dear ${c.name}, update on your ${db.serviceById(j.serviceIds[0]).name} request (${j.id}): status is now "${j.status}". — Updaate Computers`)} target="_blank" rel="noreferrer">
              <MessageCircle /> Update customer
            </a>
            {can('service_jobs.status') && options.length > 0 && (
              <Menu
                trigger={
                  <button className="btn btn-primary">
                    Change status <ChevronDown />
                  </button>
                }
              >
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
              <span className={`step ${s.done ? 'done' : s.current ? 'current' : ''}`}>
                <span className="n">{s.done ? <Check /> : i + 1}</span>
                {s.label}
              </span>
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
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Category</th>
                    <th className="ta-r">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {j.serviceIds.map((sid) => {
                    const s = db.serviceById(sid);
                    return (
                      <tr key={sid}>
                        <td style={{ fontWeight: 600 }}>{s.name}</td>
                        <td className="muted">{db.serviceCategories.find((x) => x.id === s.categoryId)?.name}</td>
                        <td className="ta-r num">{money(s.price)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            title="Historical attachments"
            sub={j.docs.length ? `${up} of ${j.docs.length} uploaded · existing job records` : 'No attachments on this job'}
          >
            {j.docs.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No historical attachments.</p>}
            {j.docs.map((d) => (
              <div className="doc-row" key={d.name}>
                <span className={`doc-ico ${d.uploaded ? 'ok' : 'missing'}`}>{d.uploaded ? <FileText /> : <FileUp />}</span>
                <div className="doc-row__meta">
                  <strong>
                    {d.name}
                    {d.sensitive && (
                      <span className="tag" title="Sensitive identity document">
                        <ShieldAlert /> Sensitive
                      </span>
                    )}
                  </strong>
                  <span>{d.uploaded ? `${d.file} · ${d.size}` : 'Not uploaded yet'}</span>
                </div>
                {d.uploaded ? (
                  d.sensitive && !canSensitive ? (
                    <span className="lock-note" title="Ask the Admin for access">
                      <Lock /> Restricted
                    </span>
                  ) : (
                    <button className="btn btn-ghost btn-sm" onClick={() => toast('info', `Opening ${d.file}`, d.sensitive ? 'Access to sensitive documents is logged in the audit trail.' : undefined)}>
                      <Eye /> View
                    </button>
                  )
                ) : null}
              </div>
            ))}
          </Panel>

          <Panel title="Status history">
            <div className="timeline">
              {[...j.history].reverse().map((h, i) => (
                <div className="tl-item" key={i}>
                  <span className={`tl-item__dot ${h.status === 'Completed' ? 'success' : h.status === 'Cancelled' ? 'danger' : h.status === 'In Process' ? 'info' : h.status === 'On Hold' ? 'warning' : 'primary'}`}>
                    {h.status in STATUS_ICON ? STATUS_ICON[h.status as JobStatus] : h.status === 'Document' ? <FileUp /> : <StickyNote />}
                  </span>
                  <div className="tl-item__title">{h.status === 'Created' ? 'Job created' : h.status === 'Document' ? 'Document uploaded' : `Moved to ${h.status}`}</div>
                  <div className="tl-item__meta">
                    {dateTime(h.at)} · {db.staffById(h.by).name}
                  </div>
                  {h.note && <div className="tl-item__note">{h.note}</div>}
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <aside className="stack">
          <Panel title="Customer" actions={<Link to={`/services/customers/${c.id}`} className="btn btn-ghost btn-sm">Profile</Link>}>
            <div className="person" style={{ marginBottom: 14 }}>
              <Avatar name={c.name} size="lg" />
              <div className="person__meta">
                <strong style={{ fontSize: 15 }}>{c.name}</strong>
                <span>{c.id}</span>
              </div>
            </div>
            <dl className="kv-list">
              <dt>Mobile</dt>
              <dd className="num">
                <a href={`tel:${c.mobile.replace(/\s/g, '')}`}>
                  <Phone size={12} /> {c.mobile}
                </a>
              </dd>
              <dt>WhatsApp</dt>
              <dd className="num">{c.whatsapp}</dd>
              <dt>Address</dt>
              <dd>{c.address}</dd>
              <dt>Total jobs</dt>
              <dd>{customerJobs(c).length}</dd>
            </dl>
          </Panel>

          <Panel title="Job details">
            <dl className="kv-list">
              <dt>Service date</dt>
              <dd>{date(j.serviceDate)}</dd>
              <dt>Last date</dt>
              <dd>
                <DueLabel j={j} />
              </dd>
              {j.formName && (
                <>
                  <dt>Form</dt>
                  <dd>{j.formName}</dd>
                </>
              )}
            </dl>
            <hr className="divider" />
            <div className="field__label" style={{ marginBottom: 8 }}>
              Assigned staff
            </div>
            {j.assignees.map((a) => (
              <div key={a} className="person" style={{ marginBottom: 8 }}>
                <Avatar name={db.staffById(a).name} size="sm" />
                <div className="person__meta">
                  <strong style={{ fontSize: 13 }}>{db.staffById(a).name}</strong>
                  <span>{db.staffById(a).designation}</span>
                </div>
              </div>
            ))}
          </Panel>

          <Panel title="Billing" icon={<ReceiptText />}>
            {bill ? (
              <>
                <div className="row-between" style={{ marginBottom: 12 }}>
                  <span className="id">{bill.id}</span>
                  <BillStatusBadge s={bill.status} />
                </div>
                <div className="row-between" style={{ marginBottom: 14 }}>
                  <span className="muted">Grand total</span>
                  <strong className="num" style={{ fontSize: 20 }}>
                    {money(Math.max(0, bill.items.reduce((t, i) => t + i.qty * i.rate, 0) - bill.discount))}
                  </strong>
                </div>
                <Link to={`/services/bills/${bill.id}`} className="btn btn-secondary btn-block">
                  {bill.status === 'Unpaid' ? 'Open bill & collect payment' : 'View bill'}
                </Link>
              </>
            ) : (
              <>
                <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                  No bill yet. Estimated amount <strong className="num" style={{ color: 'var(--ink)' }}>{money(est)}</strong> from Service Master rates.
                </p>
                {can('service_bill.create') && j.status !== 'Cancelled' && (
                  <button
                    className="btn btn-primary btn-block"
                    onClick={() => nav(`/services/bills/new?job=${j.id}`)}
                  >
                    <ReceiptText /> Create bill
                  </button>
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
        title={`Move ${j.id} to ${next}?`}
        body={next === 'Cancelled' ? 'Cancelled jobs are excluded from pending lists. Any unpaid bill should be cancelled by an Admin.' : `Current status: ${j.status}. The change is recorded in the status history.`}
        confirmLabel={`Mark ${next}`}
        busy={busy}
        disabled={(next === 'Cancelled' || next === 'On Hold') && note.trim().length < 3}
        onConfirm={() => {
          setBusy(true);
          setTimeout(() => {
            setJobStatus(j.id, next!, note, user.id);
            setBusy(false);
            toast('success', `${j.id} marked ${next}`);
            setNext(null);
          }, 500);
        }}
      >
        <Field label={next === 'Cancelled' || next === 'On Hold' ? 'Reason' : 'Note (optional)'} required={next === 'Cancelled' || next === 'On Hold'} htmlFor="sn">
          <textarea id="sn" className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={next === 'Completed' ? 'e.g. Acknowledgement slip handed over' : ''} />
        </Field>
      </Confirm>
    </>
  );
}
