import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, BarChart3, ChevronLeft, ChevronRight, Info, Printer, Table2 } from 'lucide-react';
import { BarChart, Legend, type Series } from '../components/BarChart';
import { Empty, LoadError, PageHeader, Panel, Progress, Segmented, SkeletonRows } from '../components/ui';
import { useQuery } from '../api/client';
import type { PayMode, SeriesRow } from '../api/types';
import { date, iso, longDate, money, n, time, toDate } from '../lib/format';

/* ------------------------------ Daily cash (UX-019) ------------------------------ */

interface DailyCashData {
  date: string; fees: string; services: string; expenses: string; net: string; counts: { receipts: number; paid_bills: number; expenses: number };
  ledger: { at: string; kind: 'Student fee' | 'Service bill' | 'Expense'; ref: string; party: string; mode: PayMode; amount: string }[];
  by_mode: { mode: PayMode; label: string; in: string; out: string; net: string }[];
}

export function DailyCash() {
  const [d, setD] = useState(new Date());
  const shift = (k: number) => setD((x) => { const y = new Date(x); y.setDate(y.getDate() + k); return y; });
  const isToday = iso(d) === iso(new Date());
  const { data, error, loading, reload } = useQuery<DailyCashData>('/finance/daily-cash', { date: iso(d) });
  const link = (kind: string, ref: string) => (kind === 'Student fee' ? `/fees/receipts/${ref}` : kind === 'Service bill' ? `/services/bills/${ref}` : '/expenses');

  return (
    <>
      <PageHeader
        title="Daily cash"
        sub="Student payments + paid service bills − expenses, for one day."
        crumbs={[['Finance'], ['Daily cash']]}
        actions={
          <>
            <div className="row" style={{ gap: 4 }}>
              <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous day"><ChevronLeft /></button>
              <input type="date" className="input" style={{ width: 160 }} value={iso(d)} max={iso(new Date())} onChange={(e) => e.target.value && setD(toDate(e.target.value))} aria-label="Date" />
              <button className="icon-btn" onClick={() => shift(1)} disabled={isToday} aria-label="Next day"><ChevronRight /></button>
            </div>
            <button className="btn btn-secondary" onClick={() => window.print()}><Printer /> Print</button>
          </>
        }
      />
      <p className="muted" style={{ marginTop: -10, marginBottom: 16, fontSize: 13 }}>{longDate(d)}{isToday && ' · live'}</p>

      {error ? <LoadError error={error} retry={reload} /> : loading || !data ? <SkeletonRows rows={6} cols={5} /> : (
        <>
          <section className="panel" style={{ marginBottom: 18 }}>
            <div className="ledger-sum">
              <div><span>Student payments</span><strong>{money(data.fees)}</strong><div className="muted" style={{ fontSize: 12 }}>{data.counts.receipts} receipts</div><span className="op">+</span></div>
              <div><span>Service bills</span><strong>{money(data.services)}</strong><div className="muted" style={{ fontSize: 12 }}>{data.counts.paid_bills} paid bills</div><span className="op">−</span></div>
              <div><span>Expenses</span><strong style={{ color: 'var(--danger-700)' }}>{money(data.expenses)}</strong><div className="muted" style={{ fontSize: 12 }}>{data.counts.expenses} entries</div><span className="op">=</span></div>
              <div className="net"><span>Net cash</span><strong>{money(data.net)}</strong><div className="muted" style={{ fontSize: 12 }}>for the day</div></div>
            </div>
          </section>

          <div className="dash-grid">
            <Panel flush title="Transactions" sub={`${data.ledger.length} entries`}>
              {data.ledger.length === 0 ? (
                <Empty icon={<Table2 />} title="No transactions on this day" body="Pick another date to see its cash movement." />
              ) : (
                <div className="table-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
                  <table className="table">
                    <thead><tr><th>Time</th><th>Type</th><th>Details</th><th>Mode</th><th className="ta-r">Amount</th></tr></thead>
                    <tbody>
                      {data.ledger.map((l) => {
                        const out = n(l.amount) < 0;
                        return (
                          <tr key={l.kind + l.ref}>
                            <td className="num">{time(l.at)}</td>
                            <td><span className={`badge ${out ? 'badge--danger' : l.kind === 'Student fee' ? 'badge--primary' : 'badge--info'}`}>{out ? <ArrowUpRight /> : <ArrowDownLeft />}{l.kind}</span></td>
                            <td style={{ whiteSpace: 'normal' }}><Link to={link(l.kind, l.ref)} style={{ color: 'inherit', fontWeight: 600 }}>{l.party}</Link><div className="id" style={{ fontSize: 11 }}>{l.ref}</div></td>
                            <td>{l.mode}</td>
                            <td className="ta-r num" style={{ fontWeight: 700, color: out ? 'var(--danger-700)' : 'var(--success-700)' }}>{out ? '− ' : '+ '}{money(Math.abs(n(l.amount)))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            <Panel flush title="By payment mode" sub="Match against the cash drawer and UPI statement">
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Mode</th><th className="ta-r">In</th><th className="ta-r">Out</th><th className="ta-r">Net</th></tr></thead>
                  <tbody>
                    {data.by_mode.map((r) => (
                      <tr key={r.mode}><td style={{ fontWeight: 600 }}>{r.label}</td><td className="ta-r num">{money(r.in)}</td><td className="ta-r num">{money(r.out)}</td><td className="ta-r num" style={{ fontWeight: 700 }}>{money(r.net)}</td></tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr><td>Total</td><td className="ta-r num">{money(n(data.fees) + n(data.services))}</td><td className="ta-r num">{money(data.expenses)}</td><td className="ta-r num">{money(data.net)}</td></tr>
                  </tfoot>
                </table>
              </div>
              <div style={{ padding: 16 }}>
                <div className="callout info"><Info /><span>Cash in hand should equal the Cash row’s net plus the opening balance.</span></div>
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------ Profit & Loss (UX-020) ------------------------------ */

const PL_SERIES: Series[] = [
  { key: 'income', name: 'Income', color: 'var(--series-1)' },
  { key: 'expenses', name: 'Expenses', color: 'var(--series-3)' },
];
type Period = 'today' | 'week' | 'month' | 'financial_year' | 'custom';
interface PnL {
  label: string; student_fee_income: string; service_income: string; total_income: string; expenses: string; net_profit: string; margin_pct: number;
  expense_by_category: { category: string; amount: string }[]; monthly_trend: SeriesRow[];
  service_profit: { revenue: string; cost: string | null; profit: string | null; calculation_status: string };
}
const monthLabel = (key: string) => toDate(`${key}-01`).toLocaleString('en-IN', { month: 'short', year: '2-digit' });

export function ProfitLoss() {
  const [period, setPeriod] = useState<Period>('month');
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const { data: p, error, loading, reload } = useQuery<PnL>('/finance/pnl', period === 'custom' ? { period, date_from: from, date_to: to } : { period });
  const cats = p?.expense_by_category ?? [];
  const top = n(cats[0]?.amount);

  return (
    <>
      <PageHeader
        title="Profit & loss"
        sub="Income from student fees and service bills, minus expenses. Cancelled bills and reversed payments are excluded."
        crumbs={[['Finance'], ['Profit & loss']]}
        actions={
          <>
            <Segmented value={period} onChange={setPeriod} options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }, { value: 'financial_year', label: 'Financial year' }, { value: 'custom', label: 'Custom' }]} />
            {period === 'custom' && (
              <span className="row" style={{ gap: 6 }}>
                <input type="date" className="input" style={{ width: 150 }} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="From date" />
                <span className="muted">to</span>
                <input type="date" className="input" style={{ width: 150 }} value={to} min={from} max={iso(new Date())} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="To date" />
              </span>
            )}
            <button className="btn btn-secondary" onClick={() => window.print()}><Printer /> Print</button>
          </>
        }
      />
      {error ? <LoadError error={error} retry={reload} /> : loading || !p ? <SkeletonRows rows={6} cols={4} /> : (
        <>
          <section className="panel" style={{ marginBottom: 18 }}>
            <div className="ledger-sum">
              <div><span>Student fees</span><strong>{money(p.student_fee_income)}</strong><span className="op">+</span></div>
              <div><span>Service income</span><strong>{money(p.service_income)}</strong><span className="op">−</span></div>
              <div><span>Expenses</span><strong style={{ color: 'var(--danger-700)' }}>{money(p.expenses)}</strong><span className="op">=</span></div>
              <div className="net"><span>Net profit · {p.label}</span><strong style={n(p.net_profit) < 0 ? { color: 'var(--danger-700)' } : undefined}>{money(p.net_profit)}</strong><div className="muted" style={{ fontSize: 12 }}>{p.margin_pct}% margin</div></div>
            </div>
          </section>

          <div className="dash-grid">
            <div className="stack">
              <Panel title="Monthly income vs expenses" sub="Last 12 months · current month is month-to-date"
                actions={<button className="icon-btn sm" aria-label={view === 'chart' ? 'Show as table' : 'Show as chart'} onClick={() => setView(view === 'chart' ? 'table' : 'chart')}>{view === 'chart' ? <Table2 /> : <BarChart3 />}</button>}>
                <div style={{ marginBottom: 10 }}><Legend series={PL_SERIES} /></div>
                {view === 'chart' ? (
                  <BarChart mode="grouped" ariaLabel="Monthly income versus expenses" series={PL_SERIES}
                    data={p.monthly_trend.map((m) => ({ label: monthLabel(m.key), sub: `${monthLabel(m.key)}${m.partial ? ' (to date)' : ''}`, values: { income: n(m.income), expenses: n(m.expenses) } }))} />
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>Month</th><th className="ta-r">Fees</th><th className="ta-r">Services</th><th className="ta-r">Expenses</th><th className="ta-r">Net</th></tr></thead>
                      <tbody>
                        {[...p.monthly_trend].reverse().map((m) => (
                          <tr key={m.key}>
                            <td>{monthLabel(m.key)}{m.partial && <span className="muted"> (to date)</span>}</td>
                            <td className="ta-r num">{money(m.fees)}</td><td className="ta-r num">{money(m.services)}</td><td className="ta-r num">{money(m.expenses)}</td>
                            <td className="ta-r num" style={{ fontWeight: 700 }}>{money(m.net)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
              <Panel title="Expenses by category" sub={p.label}>
                <div className="cat-bars">
                  {cats.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No expenses in this period.</p>}
                  {cats.map((c) => (
                    <div key={c.category}>
                      <div className="row-between"><span>{c.category}</span><strong className="num">{money(c.amount)}</strong></div>
                      <Progress value={top ? (n(c.amount) / top) * 100 : 0} />
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            <div className="stack">
              <Panel title="Statement" sub={p.label}>
                <div className="pl-row"><span>Student fee income</span><strong className="num">{money(p.student_fee_income)}</strong></div>
                <div className="pl-row"><span>Service income</span><strong className="num">{money(p.service_income)}</strong></div>
                <div className="pl-row" style={{ fontWeight: 700 }}><span>Total income</span><span className="num">{money(p.total_income)}</span></div>
                <div className="pl-row"><span>Total expenses</span><strong className="num" style={{ color: 'var(--danger-700)' }}>− {money(p.expenses)}</strong></div>
                <div className="pl-row total"><span>Net profit</span><span className="num">{money(p.net_profit)}</span></div>
              </Panel>
              <Panel title="Service profit">
                <div className="row-between" style={{ marginBottom: 10 }}><span className="muted">Service revenue · {p.label}</span><strong className="num">{money(p.service_profit.revenue)}</strong></div>
                <div className="callout warning"><Info /><span><strong>Cost basis pending.</strong> Service profit will be shown once per-service cost rules are confirmed (open item C-46).</span></div>
              </Panel>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>Generated {date(new Date())} · calculated on the server from valid payments, paid non-cancelled bills and expenses.</p>
        </>
      )}
    </>
  );
}
