import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Pencil, Plus, Receipt, Search, SearchX, Trash2 } from 'lucide-react';
import { errText, useApp } from '../app/AppContext';
import {
  Confirm, Drawer, Empty, Field, LoadError, Menu, MoneyInput, PageHeader, Pagination, Panel, Progress, Segmented, SkeletonRows, pager, useDebounced, usePage,
} from '../components/ui';
import { api, download, useQuery, write, type Page } from '../api/client';
import type { Expense, ExpenseCategory, PayMode } from '../api/types';
import { date, iso, money, n } from '../lib/format';
import { PAY_LABEL, PAY_MODES } from '../lib/payModes';

interface Summary { today: { amount: string; count: number }; this_month: { amount: string; count: number }; last_month: { amount: string; count: number }; this_month_by_category: { category: string; amount: string }[] }

export default function Expenses() {
  const { can, toast } = useApp();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [range, setRange] = useState<'today' | 'month' | '90d'>('month');
  const [del, setDel] = useState<Expense | null>(null);
  const [edit, setEdit] = useState<Expense | null>(null);
  const dq = useDebounced(q);
  const [page, setPage] = usePage([dq, cat, range]);
  const { data: sum } = useQuery<Summary>('/expenses/summary');
  const { data: categories } = useQuery<ExpenseCategory[]>('/expense-categories');
  const { data, error, loading, reload } = useQuery<Page<Expense> & { total_amount: string }>('/expenses', { q: dq, category_id: cat, period: range, page, page_size: 12 });
  const cats = sum?.this_month_by_category ?? [];
  const top = n(cats[0]?.amount);

  return (
    <>
      <PageHeader
        title="Expenses"
        sub="Every expense flows into Daily Cash and Profit & Loss."
        crumbs={[['Expenses']]}
        actions={
          <>
            {can('reports.view') && (
              <button className="btn btn-secondary" onClick={() => {
                const from = new Date();
                if (range === 'month') from.setDate(1);
                if (range === '90d') from.setDate(from.getDate() - 89);
                download('/reports/expense/export.xlsx', { date_from: iso(from), expense_category_id: cat }).catch((e) => toast('error', errText(e)));
              }}>
                <Download /> Export
              </button>
            )}
            {can('expenses.create') && <button className="btn btn-primary" onClick={() => setParams({ new: '1' })}><Plus /> Add expense</button>}
          </>
        }
      />

      <div className="dash-grid" style={{ marginTop: 0, marginBottom: 18 }}>
        <section className="panel" style={{ display: 'flex' }}>
          <div className="ledger-sum ledger-sum--fill" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', flex: 1 }}>
            <div><span>Today</span><strong>{money(sum?.today.amount)}</strong><div className="muted" style={{ fontSize: 12 }}>{sum?.today.count ?? 0} entries</div></div>
            <div><span>This month</span><strong>{money(sum?.this_month.amount)}</strong><div className="muted" style={{ fontSize: 12 }}>{cats.length} categories</div></div>
            <div><span>Last month</span><strong>{money(sum?.last_month.amount)}</strong><div className="muted" style={{ fontSize: 12 }}>for comparison</div></div>
          </div>
        </section>
        <Panel title="This month by category">
          <div className="cat-bars">
            {!cats.length && <p className="muted" style={{ fontSize: 13 }}>No expenses this month.</p>}
            {cats.slice(0, 4).map((c) => (
              <div key={c.category}>
                <div className="row-between"><span>{c.category}</span><strong className="num">{money(c.amount)}</strong></div>
                <Progress value={top ? (n(c.amount) / top) * 100 : 0} />
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <section className="panel">
        <div className="table-toolbar">
          <div className="input-group">
            <Search />
            <input className="input" placeholder="Search remark or category…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search expenses" />
          </div>
          <Segmented value={range} onChange={setRange} options={[{ value: 'today', label: 'Today' }, { value: 'month', label: 'This month' }, { value: '90d', label: '90 days' }]} />
          <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 13 }}>Total <strong className="num" style={{ color: 'var(--ink)' }}>{money(data?.total_amount)}</strong></span>
        </div>
        {error ? <LoadError error={error} retry={reload} /> : loading ? (
          <SkeletonRows rows={8} cols={5} />
        ) : data!.items.length === 0 ? (
          <Empty icon={q || cat ? <SearchX /> : <Receipt />} title={q || cat ? 'No expenses match' : 'No expenses in this period'} body="Add an expense to keep Daily Cash accurate." action={can('expenses.create') ? <button className="btn btn-primary" onClick={() => setParams({ new: '1' })}><Plus /> Add expense</button> : undefined} />
        ) : (
          <>
            <div className="table-wrap responsive">
              <table className="table">
                <thead><tr><th>Date</th><th>Category</th><th>Remark</th><th>Mode</th><th>Added by</th><th className="ta-r">Amount</th><th /></tr></thead>
                <tbody>
                  {data!.items.map((e) => (
                    <tr key={e.code}>
                      <td>{date(e.expense_date)}<div className="id" style={{ fontSize: 11 }}>{e.code}</div></td>
                      <td><span className="tag">{e.category.name}</span></td>
                      <td style={{ whiteSpace: 'normal' }}>{e.description}</td>
                      <td>{PAY_LABEL[e.payment_mode]}</td>
                      <td>{e.added_by?.name ?? '—'}</td>
                      <td className="ta-r num" style={{ fontWeight: 700 }}>{money(e.amount)}</td>
                      <td className="ta-r">
                        {can('expenses.edit_delete') && (
                          <Menu>
                            <button className="menu__item" onClick={() => setEdit(e)}><Pencil /> Edit</button>
                            <button className="menu__item danger" onClick={() => setDel(e)}><Trash2 /> Delete</button>
                          </Menu>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...pager(data, setPage)} noun="expenses" />
          </>
        )}
      </section>

      <ExpenseDrawer open={params.get('new') === '1' || !!edit} expense={edit} categories={(categories ?? []).filter((c) => c.is_active)} onClose={() => { setParams({}); setEdit(null); }} />

      <Confirm
        open={!!del}
        onClose={() => setDel(null)}
        tone="danger"
        icon={<Trash2 />}
        title={`Delete ${del ? money(del.amount) : ''} ${del?.category.name} expense?`}
        body="It will be removed from Daily Cash and P&L, and kept in Deleted History for audit."
        confirmLabel="Delete expense"
        onConfirm={async () => {
          try {
            await write(api(`/expenses/${del!.code}`, { method: 'DELETE' }));
            toast('success', 'Expense deleted', 'Moved to Deleted History');
          } catch (e) {
            toast('error', errText(e));
          }
          setDel(null);
        }}
      />
    </>
  );
}

function ExpenseDrawer({ open, expense, categories, onClose }: { open: boolean; expense: Expense | null; categories: ExpenseCategory[]; onClose: () => void }) {
  const { toast } = useApp();
  const blank = { expense_date: iso(new Date()), amount: '' as number | '', category_id: '', payment_mode: 'Cash' as PayMode, description: '' };
  const [f, setF] = useState(blank);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setSubmitted(false);
    setF(expense ? { expense_date: expense.expense_date, amount: n(expense.amount), category_id: String(expense.category.id), payment_mode: expense.payment_mode, description: expense.description } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expense]);
  const errs = { amount: !f.amount ? 'Enter the amount' : '', category: !f.category_id ? 'Choose a category' : '', remark: !f.description.trim() ? 'Add a short description' : '' };
  const save = async () => {
    setSubmitted(true);
    if (Object.values(errs).some(Boolean)) return;
    setBusy(true);
    try {
      const body = { ...f, amount: String(f.amount), category_id: Number(f.category_id) };
      if (expense) await write(api(`/expenses/${expense.code}`, { method: 'PATCH', body }));
      else await write(api('/expenses', { method: 'POST', body }));
      toast('success', expense ? 'Expense updated' : 'Expense added', money(Number(f.amount)));
      onClose();
    } catch (e) {
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open={open} onClose={onClose} title={expense ? `Edit expense ${expense.code}` : 'Add expense'} sub="Recorded against today’s cash unless you change the date"
      foot={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy && <span className="spinner" />}Save expense</button></>}>
      <div className="form-grid">
        <Field label="Amount" required className="span-2" error={submitted ? errs.amount : ''} htmlFor="ea"><MoneyInput id="ea" xl value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        <Field label="Date" required htmlFor="ed"><input id="ed" type="date" className="input" max={iso(new Date())} value={f.expense_date} onChange={(e) => setF({ ...f, expense_date: e.target.value })} /></Field>
        <Field label="Category" required error={submitted ? errs.category : ''} htmlFor="ec">
          <select id="ec" className="select" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
            <option value="">Select…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <div className="field span-2">
          <span className="field__label">Paid by</span>
          <Segmented block value={f.payment_mode} onChange={(v) => setF({ ...f, payment_mode: v })} options={PAY_MODES.map((m) => ({ value: m, label: m === 'Bank' ? 'Bank' : PAY_LABEL[m] }))} />
        </div>
        <Field label="Description" required className="span-2" error={submitted ? errs.remark : ''} htmlFor="er"><input id="er" className="input" placeholder="e.g. Printer toner refill" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
    </Drawer>
  );
}
