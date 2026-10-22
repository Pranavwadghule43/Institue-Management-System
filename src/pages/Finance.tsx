import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Info, Printer, Table2, BarChart3 } from 'lucide-react';
import { BarChart, Legend, type Series } from '../components/BarChart';
import { Empty, PageHeader, Panel, Progress, Segmented } from '../components/ui';
import { db, expensesOn, monthTotals, paidBillsOn, rangeTotals, sameDay, sum, useStore, validPaymentsOn } from '../data/store';
import type { PayMode } from '../data/types';
import { PAY_MODES } from '../lib/payModes';
import { date, longDate, money, time } from '../lib/format';

/* ------------------------------ Daily cash (UX-019) ------------------------------ */

export function DailyCash() {
  useStore();
  const [d, setD] = useState(new Date(db.TODAY));
  const shift = (n: number) => setD((x) => {
    const y = new Date(x);
    y.setDate(y.getDate() + n);
    return y;
  });
  const pays = validPaymentsOn(d);
  const bills = paidBillsOn(d);
  const exps = expensesOn(d);
  const fees = sum(pays, (p) => p.amount);
  const svc = sum(bills, db.billTotal);
  const exp = sum(exps, (e) => e.amount);
  const isToday = sameDay(d, db.TODAY);

  const ledger = [
    ...pays.map((p) => ({ at: p.at, kind: 'Student fee', ref: p.receiptNo, party: db.studentById(p.studentId).name, mode: p.mode, amount: p.amount, to: `/fees/receipts/${p.receiptNo}` })),
    ...bills.map((b) => ({ at: b.paidAt!, kind: 'Service bill', ref: b.id, party: db.customerById(b.customerId).name, mode: b.mode!, amount: db.billTotal(b), to: `/services/bills/${b.id}` })),
    ...exps.map((e) => ({ at: e.date, kind: 'Expense', ref: e.id, party: `${e.category} — ${e.remark}`, mode: e.mode, amount: -e.amount, to: '/expenses' })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const modes: PayMode[] = PAY_MODES;
  const byMode = modes.map((m) => {
    const i = sum(pays.filter((p) => p.mode === m), (p) => p.amount) + sum(bills.filter((b) => b.mode === m), db.billTotal);
    const o = sum(exps.filter((e) => e.mode === m), (e) => e.amount);
    return { m, i, o, net: i - o };
  });

  return (
    <>
      <PageHeader
        title="Daily cash"
        sub="Student payments + paid service bills − expenses, for one day."
        crumbs={[['Finance'], ['Daily cash']]}
        actions={
          <>
            <div className="row" style={{ gap: 4 }}>
              <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous day">
                <ChevronLeft />
              </button>
              <input type="date" className="input" style={{ width: 160 }} value={`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`} max={db.TODAY.toISOString().slice(0, 10)} onChange={(e) => e.target.value && setD(new Date(e.target.value + 'T00:00'))} aria-label="Date" />
              <button className="icon-btn" onClick={() => shift(1)} disabled={isToday} aria-label="Next day">
                <ChevronRight />
              </button>
            </div>
            <button className="btn btn-secondary" onClick={() => window.print()}>
              <Printer /> Print
            </button>
          </>
        }
      />
      <p className="muted" style={{ marginTop: -10, marginBottom: 16, fontSize: 13 }}>
        {longDate(d)}
        {isToday && ' · live'}
      </p>

      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="ledger-sum">
          <div>
            <span>Student payments</span>
            <strong>{money(fees)}</strong>
            <div className="muted" style={{ fontSize: 12 }}>{pays.length} receipts</div>
            <span className="op">+</span>
          </div>
          <div>
            <span>Service bills</span>
            <strong>{money(svc)}</strong>
            <div className="muted" style={{ fontSize: 12 }}>{bills.length} paid bills</div>
            <span className="op">−</span>
          </div>
          <div>
            <span>Expenses</span>
            <strong style={{ color: 'var(--danger-700)' }}>{money(exp)}</strong>
            <div className="muted" style={{ fontSize: 12 }}>{exps.length} entries</div>
            <span className="op">=</span>
          </div>
          <div className="net">
            <span>Net cash</span>
            <strong>{money(fees + svc - exp)}</strong>
            <div className="muted" style={{ fontSize: 12 }}>for the day</div>
          </div>
        </div>
      </section>

      <div className="dash-grid">
        <Panel flush title="Transactions" sub={`${ledger.length} entries`}>
          {ledger.length === 0 ? (
            <Empty icon={<Table2 />} title="No transactions on this day" body="Pick another date to see its cash movement." />
          ) : (
            <div className="table-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Type</th>
                    <th>Details</th>
                    <th>Mode</th>
                    <th className="ta-r">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((l) => (
                    <tr key={l.ref}>
                      <td className="num">{time(l.at)}</td>
                      <td>
                        <span className={`badge ${l.amount < 0 ? 'badge--danger' : l.kind === 'Student fee' ? 'badge--primary' : 'badge--info'}`}>
                          {l.amount < 0 ? <ArrowUpRight /> : <ArrowDownLeft />}
                          {l.kind}
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'normal' }}>
                        <Link to={l.to} style={{ color: 'inherit', fontWeight: 600 }}>
                          {l.party}
                        </Link>
                        <div className="id" style={{ fontSize: 11 }}>{l.ref}</div>
                      </td>
                      <td>{l.mode}</td>
                      <td className="ta-r num" style={{ fontWeight: 700, color: l.amount < 0 ? 'var(--danger-700)' : 'var(--success-700)' }}>
                        {l.amount < 0 ? '− ' : '+ '}
                        {money(Math.abs(l.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel flush title="By payment mode" sub="Match against the cash drawer and UPI statement">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Mode</th>
                  <th className="ta-r">In</th>
                  <th className="ta-r">Out</th>
                  <th className="ta-r">Net</th>
                </tr>
              </thead>
              <tbody>
                {byMode.map((r) => (
                  <tr key={r.m}>
                    <td style={{ fontWeight: 600 }}>{r.m}</td>
                    <td className="ta-r num">{money(r.i)}</td>
                    <td className="ta-r num">{money(r.o)}</td>
                    <td className="ta-r num" style={{ fontWeight: 700 }}>
                      {money(r.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="ta-r num">{money(fees + svc)}</td>
                  <td className="ta-r num">{money(exp)}</td>
                  <td className="ta-r num">{money(fees + svc - exp)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div style={{ padding: 16 }}>
            <div className="callout info">
              <Info />
              <span>Cash in hand should equal the Cash row’s net plus the opening balance.</span>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}

/* ------------------------------ Profit & Loss (UX-020) ------------------------------ */

const PL_SERIES: Series[] = [
  { key: 'income', name: 'Income', color: 'var(--series-1)' },
  { key: 'expenses', name: 'Expenses', color: 'var(--series-3)' },
];

export function ProfitLoss() {
  useStore();
  const [period, setPeriod] = useState<'day' | 'week' | 'month' | 'year' | 'custom'>('month');
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const [from, setFrom] = useState(iso(db.day(-29)));
  const [to, setTo] = useState(iso(db.TODAY));
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const cur = monthTotals(0);
  const prev = monthTotals(-1);

  const months = useMemo(() => {
    const hist = db.monthHistory.map((m) => ({ ...m }));
    hist[hist.length - 1] = { ...hist[hist.length - 1], fees: prev.fees || hist[hist.length - 1].fees, services: prev.services || hist[hist.length - 1].services, expenses: prev.expenses || hist[hist.length - 1].expenses };
    return [...hist, { label: db.TODAY.toLocaleString('en-IN', { month: 'short' }), fees: cur.fees, services: cur.services, expenses: cur.expenses, partial: true }];
  }, [cur.fees, cur.services, cur.expenses, prev.fees, prev.services, prev.expenses]);

  // Financial year (April–March): months from April up to the current month
  const fyMonths = ((db.TODAY.getMonth() - 3 + 12) % 12) + 1;
  const weekStart = db.day(-((db.TODAY.getDay() + 6) % 7));
  const t =
    period === 'day' ? rangeTotals(db.TODAY, db.TODAY)
    : period === 'week' ? rangeTotals(weekStart, db.TODAY)
    : period === 'month' ? cur
    : period === 'custom' ? rangeTotals(new Date(from + 'T00:00'), new Date(to + 'T00:00'))
    : { fees: sum(months.slice(-fyMonths), (m) => m.fees), services: sum(months.slice(-fyMonths), (m) => m.services), expenses: sum(months.slice(-fyMonths), (m) => m.expenses), byCat: cur.byCat };
  const { fees, services, expenses } = t;
  const income = fees + services;
  const net = income - expenses;
  const byCat = t.byCat;
  const fyStart = new Date(db.TODAY.getFullYear() - (db.TODAY.getMonth() < 3 ? 1 : 0), 3, 1);
  const label = {
    day: 'Today',
    week: 'This week',
    month: 'This month (to date)',
    year: `FY ${fyStart.getFullYear()}–${String(fyStart.getFullYear() + 1).slice(2)} (to date)`,
    custom: `${date(new Date(from + 'T00:00'))} – ${date(new Date(to + 'T00:00'))}`,
  }[period];
  const catLabel = period === 'year' ? 'This month (to date)' : label;
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  void prev;

  return (
    <>
      <PageHeader
        title="Profit & loss"
        sub="Income from student fees and service bills, minus expenses. Cancelled bills and reversed payments are excluded."
        crumbs={[['Finance'], ['Profit & loss']]}
        actions={
          <>
            <Segmented
              value={period}
              onChange={setPeriod}
              options={[
                { value: 'day', label: 'Today' },
                { value: 'week', label: 'This week' },
                { value: 'month', label: 'This month' },
                { value: 'year', label: 'Financial year' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
            {period === 'custom' && (
              <span className="row" style={{ gap: 6 }}>
                <input type="date" className="input" style={{ width: 150 }} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="From date" />
                <span className="muted">to</span>
                <input type="date" className="input" style={{ width: 150 }} value={to} min={from} max={iso(db.TODAY)} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="To date" />
              </span>
            )}
            <button className="btn btn-secondary" onClick={() => window.print()}>
              <Printer /> Print
            </button>
          </>
        }
      />

      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="ledger-sum">
          <div>
            <span>Student fees</span>
            <strong>{money(fees)}</strong>
            <span className="op">+</span>
          </div>
          <div>
            <span>Service income</span>
            <strong>{money(services)}</strong>
            <span className="op">−</span>
          </div>
          <div>
            <span>Expenses</span>
            <strong style={{ color: 'var(--danger-700)' }}>{money(expenses)}</strong>
            <span className="op">=</span>
          </div>
          <div className="net">
            <span>Net profit · {label}</span>
            <strong style={net < 0 ? { color: 'var(--danger-700)' } : undefined}>{money(net)}</strong>
            <div className="muted" style={{ fontSize: 12 }}>{income ? Math.round((net / income) * 100) : 0}% margin</div>
          </div>
        </div>
      </section>

      <div className="dash-grid">
        <div className="stack">
        <Panel
          title="Monthly income vs expenses"
          sub="Last 12 months · current month is month-to-date"
          actions={
            <button className="icon-btn sm" aria-label={view === 'chart' ? 'Show as table' : 'Show as chart'} onClick={() => setView(view === 'chart' ? 'table' : 'chart')}>
              {view === 'chart' ? <Table2 /> : <BarChart3 />}
            </button>
          }
        >
          <div style={{ marginBottom: 10 }}>
            <Legend series={PL_SERIES} />
          </div>
          {view === 'chart' ? (
            <BarChart
              mode="grouped"
              ariaLabel="Monthly income versus expenses"
              series={PL_SERIES}
              data={months.map((m) => ({ label: m.label, sub: `${m.label}${m.partial ? ' (to date)' : ''}`, values: { income: m.fees + m.services, expenses: m.expenses } }))}
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="ta-r">Fees</th>
                    <th className="ta-r">Services</th>
                    <th className="ta-r">Expenses</th>
                    <th className="ta-r">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {[...months].reverse().map((m) => (
                    <tr key={m.label}>
                      <td>{m.label}{m.partial && <span className="muted"> (to date)</span>}</td>
                      <td className="ta-r num">{money(m.fees)}</td>
                      <td className="ta-r num">{money(m.services)}</td>
                      <td className="ta-r num">{money(m.expenses)}</td>
                      <td className="ta-r num" style={{ fontWeight: 700 }}>{money(m.fees + m.services - m.expenses)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
            <Panel title="Expenses by category" sub={catLabel}>
              <div className="cat-bars">
                {cats.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No expenses in this period.</p>}
                {cats.map(([c, v]) => (
                  <div key={c}>
                    <div className="row-between">
                      <span>{c}</span>
                      <strong className="num">{money(v)}</strong>
                    </div>
                    <Progress value={(v / cats[0][1]) * 100} />
                  </div>
                ))}
              </div>
            </Panel>
        </div>

        <div className="stack">
          <Panel title="Statement" sub={label}>
            <div className="pl-row">
              <span>Student fee income</span>
              <strong className="num">{money(fees)}</strong>
            </div>
            <div className="pl-row">
              <span>Service income</span>
              <strong className="num">{money(services)}</strong>
            </div>
            <div className="pl-row" style={{ fontWeight: 700 }}>
              <span>Total income</span>
              <span className="num">{money(income)}</span>
            </div>
            <div className="pl-row">
              <span>Total expenses</span>
              <strong className="num" style={{ color: 'var(--danger-700)' }}>− {money(expenses)}</strong>
            </div>
            <div className="pl-row total">
              <span>Net profit</span>
              <span className="num">{money(net)}</span>
            </div>
          </Panel>
          <Panel title="Service profit">
            <div className="row-between" style={{ marginBottom: 10 }}>
              <span className="muted">Service revenue · {label}</span>
              <strong className="num">{money(services)}</strong>
            </div>
            <div className="callout warning">
              <Info />
              <span>
                <strong>Cost basis pending.</strong> Service profit will be shown once per-service cost rules are confirmed (open item C-46).
              </span>
            </div>
          </Panel>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>Generated {date(new Date())} · figures are calculated on the server from valid payments, paid non-cancelled bills and expenses.</p>
    </>
  );
}
