import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, ReceiptText, Search, SearchX } from 'lucide-react';
import {
  BillStatusBadge, Empty, LoadError, PageHeader, Pagination, Person, Segmented, SkeletonRows, pager, useDebounced, usePage,
} from '../../components/ui';
import { useQuery, type Page } from '../../api/client';
import type { BillRow, BillStatus } from '../../api/types';
import { date, money } from '../../lib/format';
import { PAY_LABEL } from '../../lib/payModes';

type Totals = Record<BillStatus, { amount: string; count: number }> & { average_paid: string };

export function Bills() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [st, setSt] = useState<'' | BillStatus>('');
  const dq = useDebounced(q);
  const [page, setPage] = usePage([dq, st]);
  const { data, error, loading, reload } = useQuery<Page<BillRow> & { totals: Totals }>('/service-bills', { q: dq, status: st, page, page_size: 12 });
  const t = data?.totals;

  return (
    <>
      <PageHeader
        title="Service bills"
        sub="Separate from student fee receipts. Each bill is paid in full, once."
        crumbs={[['Services'], ['Service bills']]}
        actions={<Link className="btn btn-primary" to="/services/bills/new"><Plus /> New bill</Link>}
      />
      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="ledger-sum">
          <div>
            <span>Paid</span>
            <strong style={{ color: 'var(--success-700)' }}>{money(t?.Paid.amount)}</strong>
            <div className="muted" style={{ fontSize: 12 }}>{t?.Paid.count ?? 0} bills</div>
          </div>
          <div>
            <span>Unpaid</span>
            <strong style={{ color: 'var(--warning-700)' }}>{money(t?.Unpaid.amount)}</strong>
            <div className="muted" style={{ fontSize: 12 }}>{t?.Unpaid.count ?? 0} bills awaiting payment</div>
          </div>
          <div>
            <span>Cancelled</span>
            <strong style={{ color: 'var(--ink-3)' }}>{money(t?.Cancelled.amount)}</strong>
            <div className="muted" style={{ fontSize: 12 }}>Excluded from revenue</div>
          </div>
          <div>
            <span>Average bill</span>
            <strong>{money(t?.average_paid)}</strong>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="table-toolbar">
          <div className="input-group">
            <Search />
            <input className="input" placeholder="Bill no, job ID or customer…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search bills" />
          </div>
          <Segmented value={st} onChange={setSt} options={[{ value: '', label: 'All' }, { value: 'Unpaid', label: 'Unpaid' }, { value: 'Paid', label: 'Paid' }, { value: 'Cancelled', label: 'Cancelled' }]} />
        </div>
        {error ? <LoadError error={error} retry={reload} /> : loading ? (
          <SkeletonRows rows={8} cols={6} />
        ) : data!.items.length === 0 ? (
          q || st ? <Empty icon={<SearchX />} title="No bills found" body="Try another search or status." /> : <Empty icon={<ReceiptText />} title="No service bills yet" body="Bills are created from service jobs." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Bill</th><th>Customer</th><th>Job</th><th>Date</th><th>Mode</th><th className="ta-r">Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {data!.items.map((b) => (
                    <tr key={b.code} className="is-clickable" onClick={() => nav(`/services/bills/${b.code}`)} style={b.status === 'Cancelled' ? { opacity: 0.6 } : undefined}>
                      <td className="id">{b.code}</td>
                      <td><Person name={b.customer} sub={`${b.items} item${b.items === 1 ? '' : 's'}`} /></td>
                      <td className="id">{b.job_code}</td>
                      <td>{date(b.created_at)}</td>
                      <td>{b.mode ? <span className="tag">{PAY_LABEL[b.mode]}</span> : <span className="muted">—</span>}</td>
                      <td className="ta-r num" style={{ fontWeight: 700, textDecoration: b.status === 'Cancelled' ? 'line-through' : undefined }}>{money(b.grand_total)}</td>
                      <td><BillStatusBadge s={b.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...pager(data, setPage)} noun="bills" />
          </>
        )}
      </section>
    </>
  );
}
