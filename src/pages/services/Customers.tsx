import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Briefcase, MapPin, MessageCircle, Phone, Plus, Search, SearchX, UserRound, Wrench } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import {
  Avatar, BillStatusBadge, Drawer, Empty, Field, JobStatusBadge, PageHeader, Pagination, Panel, Person, SkeletonRows, Tabs, useDebounced, useLoading, usePaged,
} from '../../components/ui';
import { addCustomer, customerBills, customerJobs, db, lastVisit, sum, useStore } from '../../data/store';
import { date, money, relDays } from '../../lib/format';
import { waLink } from '../../lib/whatsapp';
import NotFound from '../NotFound';

export function Customers() {
  useStore();
  const { can } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const loading = useLoading(400);
  const rows = useMemo(() => {
    const s = dq.trim().toLowerCase().replace(/\s/g, '');
    return db.customers.filter((c) => !s || c.name.toLowerCase().replace(/\s/g, '').includes(s) || c.mobile.replace(/\s/g, '').includes(s) || c.id.toLowerCase().includes(s));
  }, [dq, db.customers.length]);
  const pg = usePaged(rows, 12);

  return (
    <>
      <PageHeader
        title="Customers"
        sub="Service customers are kept separate from students."
        crumbs={[['Services'], ['Customers']]}
        actions={
          can('customers.manage') && (
            <button className="btn btn-primary" onClick={() => setParams({ new: '1' })}>
              <Plus /> New customer
            </button>
          )
        }
      />
      <section className="panel">
        <div className="table-toolbar">
          <div className="input-group">
            <Search />
            <input className="input" placeholder="Name, mobile or customer ID…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
          </div>
        </div>
        {loading ? (
          <SkeletonRows rows={8} cols={5} />
        ) : rows.length === 0 ? (
          <Empty icon={<SearchX />} title={`No customer matches “${q}”`} body="Check the mobile number, or add them as a new customer." action={can('customers.manage') ? <button className="btn btn-primary" onClick={() => setParams({ new: '1' })}><Plus /> Add customer</button> : undefined} />
        ) : (
          <>
            <div className="table-wrap responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Mobile</th>
                    <th>WhatsApp</th>
                    <th>Last visit</th>
                    <th className="ta-r">Jobs</th>
                    <th className="ta-r">Total billed</th>
                    <th className="ta-r" />
                  </tr>
                </thead>
                <tbody>
                  {pg.slice.map((c) => {
                    const jobs = customerJobs(c);
                    const billed = sum(customerBills(c).filter((b) => b.status === 'Paid'), db.billTotal);
                    return (
                      <tr key={c.id} className="is-clickable" onClick={() => nav(`/services/customers/${c.id}`)}>
                        <td>
                          <Person name={c.name} sub={c.id} />
                        </td>
                        <td className="num">{c.mobile}</td>
                        <td className="num">{c.whatsapp === c.mobile ? <span className="muted">Same</span> : c.whatsapp}</td>
                        <td>{relDays(lastVisit(c))}</td>
                        <td className="ta-r num">{jobs.length}</td>
                        <td className="ta-r num" style={{ fontWeight: 600 }}>
                          {money(billed)}
                        </td>
                        <td className="ta-r" onClick={(e) => e.stopPropagation()}>
                          <Link className="btn btn-secondary btn-sm" to={`/services/jobs?new=1`}>
                            <Wrench /> New job
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="card-list">
              {pg.slice.map((c) => (
                <Link key={c.id} to={`/services/customers/${c.id}`} className="m-card">
                  <div className="m-card__row">
                    <Person name={c.name} sub={`${c.id} · ${c.mobile}`} />
                    <span className="muted" style={{ fontSize: 12 }}>
                      {customerJobs(c).length} jobs
                    </span>
                  </div>
                </Link>
              ))}
            </div>
            <Pagination {...pg} noun="customers" />
          </>
        )}
      </section>
      <NewCustomer open={params.get('new') === '1'} onClose={() => setParams({})} />
    </>
  );
}

function NewCustomer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, toast } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', mobile: '', whatsapp: '', same: true, address: '' });
  const [submitted, setSubmitted] = useState(false);
  const dup = db.customers.find((c) => f.mobile.replace(/\D/g, '').length === 10 && c.mobile.replace(/\s/g, '') === f.mobile.replace(/\D/g, ''));
  const errs = {
    name: !f.name.trim() ? 'Name is required' : '',
    mobile: !/^[6-9]\d{9}$/.test(f.mobile.replace(/\D/g, '')) ? 'Enter a valid 10-digit mobile number' : '',
  };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New customer"
      sub="For digital service requests"
      foot={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              setSubmitted(true);
              if (errs.name || errs.mobile) return;
              const m = f.mobile.replace(/\D/g, '').replace(/(\d{5})(\d{5})/, '$1 $2');
              const c = addCustomer({ name: f.name.trim(), mobile: m, whatsapp: f.same ? m : f.whatsapp, address: f.address }, user.id);
              toast('success', 'Customer added', `${c.name} · ${c.id}`);
              setF({ name: '', mobile: '', whatsapp: '', same: true, address: '' });
              setSubmitted(false);
              onClose();
              nav(`/services/customers/${c.id}`);
            }}
          >
            Save customer
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Full name" required className="span-2" error={submitted ? errs.name : ''} htmlFor="cn">
          <input id="cn" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Mobile" required error={submitted ? errs.mobile : ''} htmlFor="cm">
          <input id="cm" className="input num" inputMode="numeric" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value.replace(/[^\d ]/g, '') })} />
        </Field>
        <Field label="WhatsApp" htmlFor="cw">
          <input id="cw" className="input num" disabled={f.same} value={f.same ? f.mobile : f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} />
          <label className="check">
            <input type="checkbox" checked={f.same} onChange={(e) => setF({ ...f, same: e.target.checked })} /> Same as mobile
          </label>
        </Field>
        {dup && (
          <div className="callout warning span-2">
            <UserRound />
            <span>
              <strong>{dup.name}</strong> already uses this number.{' '}
              <Link to={`/services/customers/${dup.id}`} onClick={onClose}>
                Open existing customer
              </Link>
            </span>
          </div>
        )}
        <Field label="Address" className="span-2" htmlFor="ca">
          <textarea id="ca" className="textarea" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </Field>
      </div>
    </Drawer>
  );
}

export function CustomerProfile() {
  useStore();
  const { id } = useParams();
  const [tab, setTab] = useState<'jobs' | 'bills'>('jobs');
  const c = db.customers.find((x) => x.id === id);
  if (!c) return <NotFound what="customer" />;
  const jobs = [...customerJobs(c)].reverse();
  const bills = [...customerBills(c)].reverse();
  const paid = sum(bills.filter((b) => b.status === 'Paid'), db.billTotal);
  const due = sum(bills.filter((b) => b.status === 'Unpaid'), db.billTotal);

  return (
    <>
      <PageHeader title="Customer profile" crumbs={[['Services'], ['Customers', '/services/customers'], [c.name]]} />
      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="profile-head">
          <Avatar name={c.name} size="xl" />
          <div className="profile-head__meta">
            <h1>{c.name}</h1>
            <div className="profile-head__facts">
              <span className="id">{c.id}</span>
              <span>
                <Phone /> {c.mobile}
              </span>
              <span>
                <MapPin /> {c.address}
              </span>
              <span>Customer since {date(c.createdAt)}</span>
            </div>
          </div>
          <div className="row">
            <a className="btn btn-whatsapp" href={waLink(c.whatsapp, `Namaste ${c.name}, `)} target="_blank" rel="noreferrer">
              <MessageCircle /> WhatsApp
            </a>
            <Link className="btn btn-primary" to="/services/jobs?new=1">
              <Plus /> New job
            </Link>
          </div>
        </div>
        <div className="fee-hero">
          <div>
            <span>Total jobs</span>
            <strong>{jobs.length}</strong>
          </div>
          <div>
            <span>Last visit</span>
            <strong style={{ fontSize: 16 }}>{date(lastVisit(c))}</strong>
          </div>
          <div>
            <span>Total paid</span>
            <strong style={{ color: 'var(--success-700)' }}>{money(paid)}</strong>
          </div>
          <div>
            <span>Unpaid</span>
            <strong style={{ color: due ? 'var(--danger-700)' : undefined }}>{money(due)}</strong>
          </div>
        </div>
      </section>
      <Panel flush>
        <div style={{ padding: '0 8px' }}>
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'jobs', label: 'Service history', count: jobs.length }, { value: 'bills', label: 'Bills', count: bills.length }]} />
        </div>
        {tab === 'jobs' ? (
          jobs.length ? (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id}>
                      <td className="id">
                        <Link to={`/services/jobs/${j.id}`}>{j.id}</Link>
                      </td>
                      <td style={{ fontWeight: 600 }}>{j.serviceIds.map((s) => db.serviceById(s).name).join(', ')}</td>
                      <td>{date(j.serviceDate)}</td>
                      <td>
                        <JobStatusBadge s={j.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon={<Briefcase />} title="No service jobs yet" body="Create the first job for this customer." />
          )
        ) : bills.length ? (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id}>
                    <td className="id">
                      <Link to={`/services/bills/${b.id}`}>{b.id}</Link>
                    </td>
                    <td>{date(b.createdAt)}</td>
                    <td className="ta-r num" style={{ fontWeight: 700 }}>
                      {money(db.billTotal(b))}
                    </td>
                    <td>
                      <BillStatusBadge s={b.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={<Briefcase />} title="No bills yet" />
        )}
      </Panel>
    </>
  );
}
