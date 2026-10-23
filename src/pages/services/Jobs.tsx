import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarClock, KanbanSquare, List, Plus, RotateCcw, Search, SearchX } from 'lucide-react';
import { errText, useApp } from '../../app/AppContext';
import {
  Avatar, Drawer, Empty, Field, JobStatusBadge, JobStatusIcon, LoadError, PageHeader, Pagination, Segmented, SkeletonRows, jobTone, pager, useDebounced, usePage,
} from '../../components/ui';
import { api, useQuery, write, type Page } from '../../api/client';
import type { Customer, Job, JobStatus, Ref, Service, ServiceCategory } from '../../api/types';
import { date, iso, money, relDays, toDate } from '../../lib/format';

const LANES: JobStatus[] = ['Pending', 'In Process', 'On Hold', 'Completed', 'Cancelled'];
type JobsPage = Page<Job> & { status_counts: Record<JobStatus, number> };

export function DueLabel({ j }: { j: Job }) {
  const open = j.status === 'Pending' || j.status === 'In Process' || j.status === 'On Hold';
  if (!j.due_date) return <span className="due">—</span>;
  const due = toDate(j.due_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const soon = open && !j.overdue && due.getTime() - today.getTime() <= 2 * 86400000;
  return (
    <span className={`due ${j.overdue ? 'over' : soon ? 'soon' : ''}`} title={`Last date ${date(due)}`}>
      <CalendarClock />
      {open ? (j.overdue ? `${j.overdue_days}d overdue` : relDays(due)) : date(due)}
    </span>
  );
}

export const AssigneeStack = ({ people }: { people: Ref[] }) => (
  <span className="avatar-stack" title={people.map((p) => p.name).join(', ')}>
    {people.map((p) => <Avatar key={p.id} name={p.name} size="sm" />)}
  </span>
);

export default function Jobs() {
  const { can, role, user } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const statusParam = params.get('status') as JobStatus | null;
  const [view, setView] = useState<'board' | 'list'>(statusParam ? 'list' : 'board');
  const [q, setQ] = useState('');
  const [who, setWho] = useState(role === 'Staff' ? String(user.id) : ''); // staff land on their own jobs
  const [status, setStatus] = useState<string>(statusParam ?? '');
  const dq = useDebounced(q);
  const [page, setPage] = usePage([dq, who, status, view]);
  const { data: staff } = useQuery<Ref[]>('/directory/staff');
  const query = { q: dq, staff_id: who, status: view === 'list' ? status : '' };
  // ponytail: the board shows the latest 100 jobs per load; the list view pages through everything.
  const { data, error, loading, reload } = useQuery<JobsPage>('/service-jobs', view === 'board' ? { ...query, page_size: 100 } : { ...query, page, page_size: 12 });
  const rows = data?.items ?? [];
  const filtered = !!(q || who || (view === 'list' && status));

  return (
    <>
      <PageHeader
        title="Service jobs"
        sub="Track every customer request from intake to completion."
        crumbs={[['Services'], ['Service jobs']]}
        actions={
          <>
            <Segmented value={view} onChange={setView} options={[{ value: 'board', label: 'Board', icon: <KanbanSquare /> }, { value: 'list', label: 'List', icon: <List /> }]} />
            {can('service_jobs.create') && <button className="btn btn-primary" onClick={() => setParams({ new: '1' })}><Plus /> New job</button>}
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
            {staff?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {view === 'list' && (
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="">Any status</option>
              {LANES.map((s) => <option key={s}>{s}</option>)}
            </select>
          )}
          {filtered && <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setWho(''); setStatus(''); }}><RotateCcw /> Reset</button>}
        </div>
      </section>

      {error ? <LoadError error={error} retry={reload} /> : view === 'board' ? (
        <div className="board">
          {LANES.map((lane) => {
            const cards = rows.filter((j) => j.status === lane);
            return (
              <div className="lane" key={lane}>
                <div className="lane__head">
                  <span className={`badge badge--${jobTone(lane)}`} style={{ padding: 0, background: 'transparent', height: 'auto' }}><JobStatusIcon s={lane} /></span>
                  {lane}
                  <span className="count">{data?.status_counts[lane] ?? 0}</span>
                </div>
                <div className="lane__cards">
                  {loading
                    ? [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 116, borderRadius: 8 }} />)
                    : cards.slice(0, lane === 'Completed' ? 8 : 50).map((j) => <JobCard key={j.code} j={j} />)}
                  {!loading && (data?.status_counts[lane] ?? 0) > Math.min(cards.length, lane === 'Completed' ? 8 : 50) && (
                    <button className="btn btn-ghost btn-sm" onClick={() => { setView('list'); setStatus(lane); }}>See all {lane.toLowerCase()}</button>
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
            <Empty icon={<SearchX />} title={filtered ? 'No jobs match these filters' : 'No service jobs yet'} body={filtered ? 'Try another customer name or job ID.' : 'Create the first job from a customer request.'} />
          ) : (
            <>
              <div className="table-wrap responsive">
                <table className="table">
                  <thead><tr><th>Job</th><th>Customer</th><th>Service</th><th>Assigned</th><th>Last date</th><th>Status</th><th className="ta-r">Amount</th></tr></thead>
                  <tbody>
                    {rows.map((j) => (
                      <tr key={j.code} className="is-clickable" onClick={() => nav(`/services/jobs/${j.code}`)}>
                        <td className="id">{j.code}</td>
                        <td style={{ fontWeight: 600 }}>{j.customer.name}</td>
                        <td>
                          {j.services[0]?.name}
                          {j.services.length > 1 && <span className="tag" style={{ marginLeft: 6 }}>+{j.services.length - 1}</span>}
                          {j.application_name && <div className="muted" style={{ fontSize: 12 }}>{j.application_name}</div>}
                        </td>
                        <td><AssigneeStack people={j.assignees} /></td>
                        <td><DueLabel j={j} /></td>
                        <td><JobStatusBadge s={j.status} /></td>
                        <td className="ta-r num" style={{ fontWeight: 600 }}>{money(j.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination {...pager(data, setPage)} noun="jobs" />
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
    <Link to={`/services/jobs/${j.code}`} className="job-card">
      <div className="job-card__top"><span className="id" style={{ fontSize: 11.5 }}>{j.code}</span></div>
      <h4>
        {j.services[0]?.name}
        {j.services.length > 1 && <span className="muted" style={{ fontWeight: 500 }}> +{j.services.length - 1}</span>}
      </h4>
      <p>{j.customer.name}{j.application_name && ` · ${j.application_name}`}</p>
      <div className="job-card__foot">
        <AssigneeStack people={j.assignees} />
        <span className="row" style={{ gap: 10 }}><DueLabel j={j} /></span>
      </div>
    </Link>
  );
}

function NewJobDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useApp();
  const nav = useNavigate();
  const today = iso(new Date());
  const plus7 = iso(new Date(Date.now() + 7 * 86400000));
  const blank = { customer: null as Customer | null, serviceIds: [] as number[], formName: '', serviceDate: today, lastDate: plus7, note: '' };
  const [f, setF] = useState(blank);
  const [cq, setCq] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const dcq = useDebounced(cq);
  const { data: customers } = useQuery<Page<Customer>>(open ? '/customers' : null, { q: dcq, page_size: 5 });
  const { data: services } = useQuery<Service[]>(open ? '/services' : null, { active: true });
  const { data: categories } = useQuery<ServiceCategory[]>(open ? '/service-categories' : null);
  useEffect(() => {
    if (open) {
      setF(blank);
      setSubmitted(false);
      setCq('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const total = f.serviceIds.reduce((t, id) => t + Number(services?.find((s) => s.id === id)?.price ?? 0), 0);
  const errs = {
    customer: !f.customer ? 'Select or add a customer' : '',
    services: !f.serviceIds.length ? 'Pick at least one service' : '',
    lastDate: f.lastDate < f.serviceDate ? 'Last date can’t be before the service date' : '',
  };

  const save = async () => {
    setSubmitted(true);
    if (Object.values(errs).some(Boolean)) return;
    setBusy(true);
    try {
      const j = await write(api<Job>('/service-jobs', { method: 'POST', body: { customer_code: f.customer!.code, service_ids: f.serviceIds, application_name: f.formName, service_date: f.serviceDate, due_date: f.lastDate, notes: f.note } }));
      toast('success', `Job ${j.code} created`, `${j.services[0]?.name} for ${j.customer.name}`);
      onClose();
      nav(`/services/jobs/${j.code}`);
    } catch (e) {
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={open} onClose={onClose} title="New service job" sub="Customer intake for a digital service"
      foot={<>
        <span className="muted" style={{ marginRight: 'auto', fontSize: 13 }}>Estimate <strong className="num" style={{ color: 'var(--ink)' }}>{money(total)}</strong></span>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy && <span className="spinner" />}Create job</button>
      </>}>
      <div className="stack" style={{ gap: 18 }}>
        <Field label="Customer" required error={submitted ? errs.customer : ''}>
          {f.customer ? (
            <div className="student-pick" style={{ padding: 10 }}>
              <Avatar name={f.customer.full_name} />
              <div style={{ flex: 1 }}>
                <strong>{f.customer.full_name}</strong>
                <div className="muted" style={{ fontSize: 12 }}>{f.customer.code} · {f.customer.mobile}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setF({ ...f, customer: null })}>Change</button>
            </div>
          ) : (
            <>
              <div className="input-group">
                <Search />
                <input className="input" placeholder="Search customer by name or mobile" value={cq} onChange={(e) => setCq(e.target.value)} />
              </div>
              <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 4 }}>
                {customers?.items.map((c) => (
                  <button key={c.code} type="button" className="combo__item" onClick={() => setF({ ...f, customer: c })}>
                    <Avatar name={c.full_name} size="sm" />
                    <span style={{ fontSize: 13 }}><strong style={{ fontWeight: 600 }}>{c.full_name}</strong> <span className="muted">· {c.mobile}</span></span>
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
            {services && !services.length && <p className="muted" style={{ padding: 12, fontSize: 13 }}>No active services yet. Add them in Service Master.</p>}
            {categories?.map((cat) => {
              const list = services?.filter((s) => s.category.id === cat.id) ?? [];
              if (!list.length) return null;
              return (
                <div key={cat.id}>
                  <div className="menu__label" style={{ background: 'var(--surface-2)', padding: '6px 12px' }}>{cat.name}</div>
                  {list.map((s) => (
                    <label key={s.id} className="check" style={{ display: 'flex', padding: '8px 12px', borderBottom: '1px solid var(--line)' }}>
                      <input type="checkbox" checked={f.serviceIds.includes(s.id)}
                        onChange={(e) => setF({ ...f, serviceIds: e.target.checked ? [...f.serviceIds, s.id] : f.serviceIds.filter((x) => x !== s.id) })} />
                      <span style={{ flex: 1, color: 'var(--ink)' }}>{s.name}</span>
                      <span className="num muted">{money(s.price)}</span>
                    </label>
                  ))}
                </div>
              );
            })}
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
