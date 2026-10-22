import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, SearchX } from 'lucide-react';
import {
  BillStatusBadge, Empty, PageHeader, Pagination, Person, Segmented, SkeletonRows, useDebounced, useLoading, usePaged,
} from '../../components/ui';
import { db, sum, useStore } from '../../data/store';
import type { BillStatus } from '../../data/types';
import { date, money } from '../../lib/format';
import { PAY_LABEL } from '../../lib/payModes';

export function Bills() {
  useStore();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [st, setSt] = useState<'' | BillStatus>('');
  const dq = useDebounced(q);
  const loading = useLoading(400);
  const rows = useMemo(() => {
    const s = dq.trim().toLowerCase();
    return [...db.bills]
      .reverse()
      .filter((b) => !st || b.status === st)
      .filter((b) => !s || b.id.toLowerCase().includes(s) || b.jobId.toLowerCase().includes(s) || db.customerById(b.customerId).name.toLowerCase().includes(s));
  }, [dq, st, db.bills.length]);
  const pg = usePaged(rows, 12);
  const tot = (s: BillStatus) => sum(db.bills.filter((b) => b.status === s), db.billTotal);

  return (
    <>
      <PageHeader
        title="Service bills"
        sub="Separate from student fee receipts. Each bill is paid in full, once."
        crumbs={[['Services'], ['Service bills']]}
        actions={
          <Link className="btn btn-primary" to="/services/bills/new">
            <Plus /> New bill
          </Link>
        }
      />
      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="ledger-sum">
          <div>
            <span>Paid</span>
            <strong style={{ color: 'var(--success-700)' }}>{money(tot('Paid'))}</strong>
            <div className="muted" style={{ fontSize: 12 }}>{db.bills.filter((b) => b.status === 'Paid').length} bills</div>
          </div>
          <div>
            <span>Unpaid</span>
            <strong style={{ color: 'var(--warning-700)' }}>{money(tot('Unpaid'))}</strong>
            <div className="muted" style={{ fontSize: 12 }}>{db.bills.filter((b) => b.status === 'Unpaid').length} bills awaiting payment</div>
          </div>
          <div>
            <span>Cancelled</span>
            <strong style={{ color: 'var(--ink-3)' }}>{money(tot('Cancelled'))}</strong>
            <div className="muted" style={{ fontSize: 12 }}>Excluded from revenue</div>
          </div>
          <div>
            <span>Average bill</span>
            <strong>{money(Math.round(tot('Paid') / Math.max(1, db.bills.filter((b) => b.status === 'Paid').length)))}</strong>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="table-toolbar">
          <div className="input-group">
            <Search />
            <input className="input" placeholder="Bill no, job ID or customer…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search bills" />
          </div>
          <Segmented
            value={st}
            onChange={setSt}
            options={[
              { value: '', label: 'All' },
              { value: 'Unpaid', label: 'Unpaid' },
              { value: 'Paid', label: 'Paid' },
              { value: 'Cancelled', label: 'Cancelled' },
            ]}
          />
        </div>
        {loading ? (
          <SkeletonRows rows={8} cols={6} />
        ) : rows.length === 0 ? (
          <Empty icon={<SearchX />} title="No bills found" body="Try another search or status." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Bill</th>
                    <th>Customer</th>
                    <th>Job</th>
                    <th>Date</th>
                    <th>Mode</th>
                    <th className="ta-r">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.slice.map((b) => (
                    <tr key={b.id} className="is-clickable" onClick={() => nav(`/services/bills/${b.id}`)} style={b.status === 'Cancelled' ? { opacity: 0.6 } : undefined}>
                      <td className="id">{b.id}</td>
                      <td>
                        <Person name={db.customerById(b.customerId).name} sub={`${b.items.length} item${b.items.length > 1 ? 's' : ''}`} />
                      </td>
                      <td className="id">{b.jobId}</td>
                      <td>{date(b.createdAt)}</td>
                      <td>{b.mode ? <span className="tag">{PAY_LABEL[b.mode]}</span> : <span className="muted">—</span>}</td>
                      <td className="ta-r num" style={{ fontWeight: 700, textDecoration: b.status === 'Cancelled' ? 'line-through' : undefined }}>
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
            <Pagination {...pg} noun="bills" />
          </>
        )}
      </section>
    </>
  );
}
