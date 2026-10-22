import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarClock, KanbanSquare, List, Plus, RotateCcw, Search, SearchX } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import {
  Avatar, Drawer, Empty, Field, JobStatusBadge, JobStatusIcon, PageHeader, Pagination, Segmented, SkeletonRows, jobTone, useDebounced, useLoading, usePaged,
} from '../../components/ui';
import { db, jobAmount, touch, useStore } from '../../data/store';
import type { Job, JobStatus, Priority } from '../../data/types';
import { date, money, relDays } from '../../lib/format';

const LANES: JobStatus[] = ['Pending', 'In Process', 'On Hold', 'Completed', 'Cancelled'];

export function DueLabel({ j }: { j: Job }) {
  const open = j.status === 'Pending' || j.status === 'In Process' || j.status === 'On Hold';
  const over = open && j.lastDate < db.TODAY;
  const soon = open && !over && j.lastDate.getTime() - db.TODAY.getTime() <= 2 * 86400000;
  return (
    <span className={`due ${over ? 'over' : soon ? 'soon' : ''}`} title={`Last date ${date(j.lastDate)}`}>
      <CalendarClock />
      {open ? (over ? `${Math.round((db.TODAY.getTime() - j.lastDate.getTime()) / 86400000)}d overdue` : relDays(j.lastDate)) : date(j.lastDate)}
    </span>
  );
}

export const AssigneeStack = ({ ids }: { ids: string[] }) => (
  <span className="avatar-stack" title={ids.map((i) => db.staffById(i).name).join(', ')}>
    {ids.map((i) => (
      <Avatar key={i} name={db.staffById(i).name} size="sm" />
    ))}
  </span>
);

export default function Jobs() {
  useStore();
  const { can } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const statusParam = params.get('status') as JobStatus | null;
  const [view, setView] = useState<'board' | 'list'>(statusParam ? 'list' : 'board');
  const [q, setQ] = useState('');
  const { role, user } = useApp();
  const [who, setWho] = useState(role === 'Staff' ? user.id : ''); // staff land on their own jobs
  const [status, setStatus] = useState<string>(statusParam ?? '');
  const dq = useDebounced(q);
  const loading = useLoading(450, [view]);

  const rows = useMemo(() => {
    const s = dq.trim().toLowerCase();
    return [...db.jobs]
      .reverse()
      .filter((j) => !s || j.id.toLowerCase().includes(s) || db.customerById(j.customerId).name.toLowerCase().includes(s) || j.serviceIds.some((x) => db.serviceById(x).name.toLowerCase().includes(s)) || j.formName.toLowerCase().includes(s))
      .filter((j) => !who || j.assignees.includes(who))
      .filter((j) => view === 'board' || !status || j.status === status);
  }, [dq, who, status, view, db.jobs.length]);
  const pg = usePaged(rows, 12);
  const filtered = !!(q || who || (view === 'list' && status));

  return (
    <>
      <PageHeader
        title="Service jobs"
        sub="Track every customer request from intake to completion."
        crumbs={[['Services'], ['Service jobs']]}
        actions={
          <>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'board', label: 'Board', icon: <KanbanSquare /> },
                { value: 'list', label: 'List', icon: <List /> },
              ]}
            />
            {can('service_jobs.create') && (
              <button className="btn btn-primary" onClick={() => setParams({ new: '1' })}>
                <Plus /> New job
              </button>
            )}
          </>
        }
      />

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="table-toolbar" style={{ borderBottom: 0 }}>
          <div className="input-group">
            <Search />
            <input className="input" placeholder="Job ID, customer, service or form…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search jobs" />
          </div>
          <select className="select" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Assigned staff">
            <option value="">All staff</option>
            {db.staff.filter((s) => s.status !== 'Disabled').map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {view === 'list' && (
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="">Any status</option>
              {LANES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          )}
          {filtered && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setQ('');
                setWho('');
                setStatus('');
              }}
            >
              <RotateCcw /> Reset
            </button>
          )}
        </div>
      </section>

      {view === 'board' ? (
        <div className="board">
          {LANES.map((lane) => {
            const cards = rows.filter((j) => j.status === lane);
            return (
              <div className="lane" key={lane}>
                <div className="lane__head">
                  <span className={`badge badge--${jobTone(lane)}`} style={{ padding: 0, background: 'transparent', height: 'auto' }}>
                    <JobStatusIcon s={lane} />
                  </span>
                  {lane}
                  <span className="count">{cards.length}</span>
                </div>
                <div className="lane__cards">
                  {loading
                    ? [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 116, borderRadius: 8 }} />)
                    : cards.slice(0, lane === 'Completed' ? 8 : 50).map((j) => <JobCard key={j.id} j={j} />)}
                  {!loading && lane === 'Completed' && cards.length > 8 && (
                    <button className="btn btn-ghost btn-sm" onClick={() => { setView('list'); setStatus('Completed'); }}>
                      + {cards.length - 8} more completed
                    </button>
                  )}
                  {!loading && cards.length === 0 && <p className="muted" style={{ fontSize: 12.5, textAlign: 'center', padding: '18px 0' }}>No jobs</p>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <section className="panel">
          {loading ? (
            <SkeletonRows rows={8} cols={6} />
          ) : rows.length === 0 ? (
            <Empty icon={<SearchX />} title="No jobs match these filters" body="Try another customer name or job ID." />
          ) : (
            <>
              <div className="table-wrap responsive">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Customer</th>
                      <th>Service</th>
                      <th>Assigned</th>
                      <th>Last date</th>
                      <th>Status</th>
                      <th className="ta-r">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pg.slice.map((j) => (
                      <tr key={j.id} className="is-clickable" onClick={() => nav(`/services/jobs/${j.id}`)}>
                        <td className="id">{j.id}</td>
                        <td style={{ fontWeight: 600 }}>{db.customerById(j.customerId).name}</td>
                        <td>
                          {db.serviceById(j.serviceIds[0]).name}
                          {j.serviceIds.length > 1 && <span className="tag" style={{ marginLeft: 6 }}>+{j.serviceIds.length - 1}</span>}
                          {j.formName && <div className="muted" style={{ fontSize: 12 }}>{j.formName}</div>}
                        </td>
                        <td>
                          <AssigneeStack ids={j.assignees} />
                        </td>
                        <td>
                          <DueLabel j={j} />
                        </td>
                        <td>
                          <JobStatusBadge s={j.status} />
                        </td>
                        <td className="ta-r num" style={{ fontWeight: 600 }}>
                          {money(jobAmount(j.id))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card-list">
                {pg.slice.map((j) => (
                  <Link key={j.id} to={`/services/jobs/${j.id}`} className="m-card">
                    <div className="m-card__row">
                      <strong>{db.serviceById(j.serviceIds[0]).name}</strong>
                      <JobStatusBadge s={j.status} />
                    </div>
                    <div className="m-card__row">
                      <span className="muted" style={{ fontSize: 12 }}>
                        {j.id} · {db.customerById(j.customerId).name}
                      </span>
                      <DueLabel j={j} />
                    </div>
                  </Link>
                ))}
              </div>
              <Pagination {...pg} noun="jobs" />
            </>
          )}
        </section>
      )}

      <NewJobDrawer open={params.get('new') === '1'} onClose={() => setParams({})} />
    </>
  );
}

function JobCard({ j }: { j: Job }) {
  return (
    <Link to={`/services/jobs/${j.id}`} className="job-card">
      <div className="job-card__top">
        <span className="id" style={{ fontSize: 11.5 }}>
          {j.id}
        </span>
      </div>
      <h4>
        {db.serviceById(j.serviceIds[0]).name}
        {j.serviceIds.length > 1 && <span className="muted" style={{ fontWeight: 500 }}> +{j.serviceIds.length - 1}</span>}
      </h4>
      <p>
        {db.customerById(j.customerId).name}
        {j.formName && ` · ${j.formName}`}
      </p>
      <div className="job-card__foot">
        <AssigneeStack ids={j.assignees} />
        <span className="row" style={{ gap: 10 }}>
          <DueLabel j={j} />
        </span>
      </div>
    </Link>
  );
}

function NewJobDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, toast } = useApp();
  const nav = useNavigate();
  const today = db.TODAY.toISOString().slice(0, 10);
  const plus7 = db.day(7).toISOString().slice(0, 10);
  const blank = { customerId: '', serviceIds: [] as string[], formName: '', serviceDate: today, lastDate: plus7, priority: 'Normal' as Priority, assignees: [user.id === 'U1' ? 'U3' : user.id], note: '' };
  const [f, setF] = useState(blank);
  const [cq, setCq] = useState('');
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    if (open) {
      setF(blank);
      setSubmitted(false);
      setCq('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const total = f.serviceIds.reduce((t, s) => t + db.serviceById(s).price, 0);
  const errs = {
    customer: !f.customerId ? 'Select or add a customer' : '',
    services: !f.serviceIds.length ? 'Pick at least one service' : '',
    lastDate: f.lastDate < f.serviceDate ? 'Last date can’t be before the service date' : '',
  };
  const custMatches = db.customers.filter((c) => !cq || c.name.toLowerCase().includes(cq.toLowerCase()) || c.mobile.replace(/\s/g, '').includes(cq.replace(/\s/g, ''))).slice(0, 5);

  const save = () => {
    setSubmitted(true);
    if (Object.values(errs).some(Boolean)) return;
    const id = `SJ-${1040 + db.jobs.length}`;
    db.jobs.push({
      id, customerId: f.customerId, serviceIds: f.serviceIds, formName: f.formName, serviceDate: new Date(f.serviceDate), lastDate: new Date(f.lastDate), priority: f.priority, assignees: f.assignees, status: 'Pending',
      docs: [],
      history: [{ at: new Date(), by: user.id, status: 'Created', note: f.note || 'Job created at counter' }],
    });
    db.audit.unshift({ id: `J${Date.now()}`, at: new Date(), actor: user.id, action: 'JOB_CREATED', entity: 'Service Job', entityId: id, summary: `${id} created for ${db.customerById(f.customerId).name}`, ip: '192.168.1.11' });
    touch();
    toast('success', `Job ${id} created`, `${db.serviceById(f.serviceIds[0]).name} for ${db.customerById(f.customerId).name}`);
    onClose();
    nav(`/services/jobs/${id}`);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New service job"
      sub="Customer intake for a digital service"
      foot={
        <>
          <span className="muted" style={{ marginRight: 'auto', fontSize: 13 }}>
            Estimate <strong className="num" style={{ color: 'var(--ink)' }}>{money(total)}</strong>
          </span>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Create job
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 18 }}>
        <Field label="Customer" required error={submitted ? errs.customer : ''}>
          {f.customerId ? (
            <div className="student-pick" style={{ padding: 10 }}>
              <Avatar name={db.customerById(f.customerId).name} />
              <div style={{ flex: 1 }}>
                <strong>{db.customerById(f.customerId).name}</strong>
                <div className="muted" style={{ fontSize: 12 }}>
                  {db.customerById(f.customerId).id} · {db.customerById(f.customerId).mobile}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setF({ ...f, customerId: '' })}>
                Change
              </button>
            </div>
          ) : (
            <>
              <div className="input-group">
                <Search />
                <input className="input" placeholder="Search customer by name or mobile" value={cq} onChange={(e) => setCq(e.target.value)} />
              </div>
              <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 4 }}>
                {custMatches.map((c) => (
                  <button key={c.id} type="button" className="combo__item" onClick={() => setF({ ...f, customerId: c.id })}>
                    <Avatar name={c.name} size="sm" />
                    <span style={{ fontSize: 13 }}>
                      <strong style={{ fontWeight: 600 }}>{c.name}</strong> <span className="muted">· {c.mobile}</span>
                    </span>
                  </button>
                ))}
                <Link to="/services/customers?new=1" className="combo__item" style={{ color: 'var(--primary-600)', fontWeight: 600, fontSize: 13 }}>
                  <Plus size={16} /> Add new customer
                </Link>
              </div>
            </>
          )}
        </Field>

        <Field label="Services" required error={submitted ? errs.services : ''} hint="Rates come from Service Master">
          <div style={{ border: '1px solid var(--line)', borderRadius: 8, maxHeight: 240, overflowY: 'auto' }}>
            {db.serviceCategories.map((cat) => (
              <div key={cat.id}>
                <div className="menu__label" style={{ background: 'var(--surface-2)', padding: '6px 12px' }}>
                  {cat.name}
                </div>
                {db.services.filter((s) => s.categoryId === cat.id && s.active).map((s) => (
                  <label key={s.id} className="check" style={{ display: 'flex', padding: '8px 12px', borderBottom: '1px solid var(--line)' }}>
                    <input
                      type="checkbox"
                      checked={f.serviceIds.includes(s.id)}
                      onChange={(e) => setF({ ...f, serviceIds: e.target.checked ? [...f.serviceIds, s.id] : f.serviceIds.filter((x) => x !== s.id) })}
                    />
                    <span style={{ flex: 1, color: 'var(--ink)' }}>{s.name}</span>
                    <span className="num muted">{money(s.price)}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </Field>


        <div className="form-grid">
          <Field label="Application / form name" className="span-2" htmlFor="fn">
            <input id="fn" className="input" placeholder="e.g. SSC CGL 2026" value={f.formName} onChange={(e) => setF({ ...f, formName: e.target.value })} />
          </Field>
          <Field label="Service date" required htmlFor="sd">
            <input id="sd" type="date" className="input" value={f.serviceDate} onChange={(e) => setF({ ...f, serviceDate: e.target.value })} />
          </Field>
          <Field label="Last date" required error={submitted ? errs.lastDate : ''} hint="Deadline for the application" htmlFor="ld">
            <input id="ld" type="date" className="input" value={f.lastDate} onChange={(e) => setF({ ...f, lastDate: e.target.value })} />
          </Field>
        </div>


        <Field label="Notes" htmlFor="jn">
          <textarea id="jn" className="textarea" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
    </Drawer>
  );
}
