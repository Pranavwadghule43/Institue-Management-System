import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Briefcase, MapPin, MessageCircle, Phone, Plus, Search, SearchX, UserRound, Users, Wrench } from 'lucide-react';
import { errText, useApp } from '../../app/AppContext';
import {
  Avatar, BillStatusBadge, Drawer, Empty, Field, JobStatusBadge, LoadError, PageHeader, Pagination, Panel, Person, SkeletonRows, Tabs, pager, useDebounced, usePage,
} from '../../components/ui';
import { api, useQuery, write, type Page } from '../../api/client';
import type { BillStatus, Customer, JobStatus } from '../../api/types';
import { date, money, relDays } from '../../lib/format';
import { waLink } from '../../lib/whatsapp';
import NotFound from '../NotFound';

export function Customers() {
  const { can } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = usePage([dq]);
  const { data, error, loading, reload } = useQuery<Page<Customer>>('/customers', { q: dq, page, page_size: 12 });

  return (
    <>
      <PageHeader
        title="Customers"
        sub="Service customers are kept separate from students."
        crumbs={[['Services'], ['Customers']]}
        actions={can('customers.manage') && <button className="btn btn-primary" onClick={() => setParams({ new: '1' })}><Plus /> New customer</button>}
      />
      <section className="panel">
        <div className="table-toolbar">
          <div className="input-group">
            <Search />
            <input className="input" placeholder="Name, mobile or customer ID…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
          </div>
        </div>
        {error ? <LoadError error={error} retry={reload} /> : loading ? (
          <SkeletonRows rows={8} cols={5} />
        ) : data!.items.length === 0 ? (
          q ? (
            <Empty icon={<SearchX />} title={`No customer matches “${q}”`} body="Check the mobile number, or add them as a new customer." action={can('customers.manage') ? <button className="btn btn-primary" onClick={() => setParams({ new: '1' })}><Plus /> Add customer</button> : undefined} />
          ) : (
            <Empty icon={<Users />} title="No customers yet" body="Add a customer to create the first service job." action={can('customers.manage') ? <button className="btn btn-primary" onClick={() => setParams({ new: '1' })}><Plus /> Add customer</button> : undefined} />
          )
        ) : (
          <>
            <div className="table-wrap responsive">
              <table className="table">
                <thead><tr><th>Customer</th><th>Mobile</th><th>WhatsApp</th><th>Last visit</th><th className="ta-r">Jobs</th><th className="ta-r">Total paid</th><th className="ta-r" /></tr></thead>
                <tbody>
                  {data!.items.map((c) => (
                    <tr key={c.code} className="is-clickable" onClick={() => nav(`/services/customers/${c.code}`)}>
                      <td><Person name={c.full_name} sub={c.code} /></td>
                      <td className="num">{c.mobile}</td>
                      <td className="num">{c.whatsapp_number === c.mobile ? <span className="muted">Same</span> : c.whatsapp_number}</td>
                      <td>{c.last_visit ? relDays(c.last_visit) : '—'}</td>
                      <td className="ta-r num">{c.total_jobs}</td>
                      <td className="ta-r num" style={{ fontWeight: 600 }}>{money(c.total_paid)}</td>
                      <td className="ta-r" onClick={(e) => e.stopPropagation()}>
                        {can('service_jobs.create') && <Link className="btn btn-secondary btn-sm" to="/services/jobs?new=1"><Wrench /> New job</Link>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...pager(data, setPage)} noun="customers" />
          </>
        )}
      </section>
      <NewCustomer open={params.get('new') === '1'} onClose={() => setParams({})} />
    </>
  );
}

function NewCustomer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useApp();
  const nav = useNavigate();
  const blank = { full_name: '', mobile: '', whatsapp_number: '', same: true, address: '' };
  const [f, setF] = useState(blank);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const digits = f.mobile.replace(/\D/g, '');
  const { data: dup } = useQuery<Page<Customer>>(open && digits.length === 10 ? '/customers' : null, { q: digits, page_size: 1 });
  const existing = dup?.items.find((c) => c.mobile === digits);

  const save = async () => {
    setBusy(true);
    try {
      const c = await write(api<Customer>('/customers', { method: 'POST', body: { full_name: f.full_name, mobile: f.mobile, whatsapp_number: f.same ? null : f.whatsapp_number, address: f.address } }));
      toast('success', 'Customer added', `${c.full_name} · ${c.code}`);
      setF(blank);
      setErrs({});
      onClose();
      nav(`/services/customers/${c.code}`);
    } catch (e) {
      setErrs((e as { fields?: Record<string, string> }).fields ?? {});
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open={open} onClose={onClose} title="New customer" sub="For digital service requests"
      foot={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy && <span className="spinner" />}Save customer</button></>}>
      <div className="form-grid">
        <Field label="Full name" required className="span-2" error={errs.full_name} htmlFor="cn"><input id="cn" className="input" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Mobile" required error={errs.mobile} htmlFor="cm"><input id="cm" className="input num" inputMode="numeric" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value.replace(/[^\d ]/g, '') })} /></Field>
        <Field label="WhatsApp" error={errs.whatsapp_number} htmlFor="cw">
          <input id="cw" className="input num" disabled={f.same} value={f.same ? f.mobile : f.whatsapp_number} onChange={(e) => setF({ ...f, whatsapp_number: e.target.value })} />
          <label className="check"><input type="checkbox" checked={f.same} onChange={(e) => setF({ ...f, same: e.target.checked })} /> Same as mobile</label>
        </Field>
        {existing && (
          <div className="callout warning span-2">
            <UserRound />
            <span><strong>{existing.full_name}</strong> already uses this number. <Link to={`/services/customers/${existing.code}`} onClick={onClose}>Open existing customer</Link></span>
          </div>
        )}
        <Field label="Address" className="span-2" htmlFor="ca"><textarea id="ca" className="textarea" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      </div>
    </Drawer>
  );
}

interface History {
  jobs: { code: string; services: string[]; application_name: string | null; service_date: string; due_date: string | null; status: JobStatus }[];
  bills: { code: string; job_code: string; created_at: string; grand_total: string; status: BillStatus }[];
  total_paid: string; unpaid: string;
}

export function CustomerProfile() {
  const { id } = useParams();
  const { can } = useApp();
  const [tab, setTab] = useState<'jobs' | 'bills'>('jobs');
  const { data: c, error, loading } = useQuery<Customer>(`/customers/${id}`);
  const { data: h } = useQuery<History>(`/customers/${id}/history`);
  if (error?.status === 404) return <NotFound what="customer" />;
  if (error) return <LoadError error={error} />;
  if (loading || !c) return <SkeletonRows rows={5} cols={4} />;

  return (
    <>
      <PageHeader title="Customer profile" crumbs={[['Services'], ['Customers', '/services/customers'], [c.full_name]]} />
      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="profile-head">
          <Avatar name={c.full_name} size="xl" />
          <div className="profile-head__meta">
            <h1>{c.full_name}</h1>
            <div className="profile-head__facts">
              <span className="id">{c.code}</span>
              <span><Phone /> {c.mobile}</span>
              {c.address && <span><MapPin /> {c.address}</span>}
              <span>Customer since {date(c.created_at)}</span>
            </div>
          </div>
          <div className="row">
            <a className="btn btn-whatsapp" href={waLink(c.whatsapp_number, `Namaste ${c.full_name}, `)} target="_blank" rel="noreferrer"><MessageCircle /> WhatsApp</a>
            {can('service_jobs.create') && <Link className="btn btn-primary" to="/services/jobs?new=1"><Plus /> New job</Link>}
          </div>
        </div>
        <div className="fee-hero">
          <div><span>Total jobs</span><strong>{c.total_jobs}</strong></div>
          <div><span>Last visit</span><strong style={{ fontSize: 16 }}>{c.last_visit ? date(c.last_visit) : '—'}</strong></div>
          <div><span>Total paid</span><strong style={{ color: 'var(--success-700)' }}>{money(c.total_paid)}</strong></div>
          <div><span>Unpaid</span><strong style={{ color: Number(c.unpaid) ? 'var(--danger-700)' : undefined }}>{money(c.unpaid)}</strong></div>
        </div>
      </section>
      <Panel flush>
        <div style={{ padding: '0 8px' }}>
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'jobs', label: 'Service history', count: h?.jobs.length }, { value: 'bills', label: 'Bills', count: h?.bills.length }]} />
        </div>
        {!h ? <SkeletonRows rows={3} cols={4} /> : tab === 'jobs' ? (
          h.jobs.length ? (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {h.jobs.map((j) => (
                    <tr key={j.code}>
                      <td className="id"><Link to={`/services/jobs/${j.code}`}>{j.code}</Link></td>
                      <td style={{ fontWeight: 600 }}>{j.services.join(', ')}</td>
                      <td>{date(j.service_date)}</td>
                      <td><JobStatusBadge s={j.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty icon={<Briefcase />} title="No service jobs yet" body="Create the first job for this customer." />
        ) : h.bills.length ? (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {h.bills.map((b) => (
                  <tr key={b.code}>
                    <td className="id"><Link to={`/services/bills/${b.code}`}>{b.code}</Link></td>
                    <td>{date(b.created_at)}</td>
                    <td className="ta-r num" style={{ fontWeight: 700 }}>{money(b.grand_total)}</td>
                    <td><BillStatusBadge s={b.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={<Briefcase />} title="No bills yet" />}
      </Panel>
    </>
  );
}
