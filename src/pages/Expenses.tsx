import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Paperclip, Pencil, Plus, Receipt, Search, SearchX, Trash2, Upload } from 'lucide-react';
import { useApp } from '../app/AppContext';
import {
  Confirm, Drawer, Empty, Field, Menu, MoneyInput, PageHeader, Pagination, Panel, Progress, Segmented, SkeletonRows, useDebounced, useLoading, usePaged,
} from '../components/ui';
import { addExpense, db, isToday, monthTotals, sum, touch, useStore } from '../data/store';
import type { Expense, PayMode } from '../data/types';
import { date, money } from '../lib/format';
import { PAY_MODES } from '../lib/payModes';

export default function Expenses() {
  useStore();
  const { can, user, toast } = useApp();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [range, setRange] = useState<'today' | 'month' | '90'>('month');
  const [del, setDel] = useState<Expense | null>(null);
  const dq = useDebounced(q);
  const loading = useLoading(400, [range]);
  const m = monthTotals(0);

  const rows = useMemo(() => {
    const s = dq.trim().toLowerCase();
    const from = range === 'today' ? db.TODAY : range === 'month' ? new Date(db.TODAY.getFullYear(), db.TODAY.getMonth(), 1) : db.day(-89, 0);
    return db.expenses.filter((e) => e.date >= from).filter((e) => !cat || e.category === cat).filter((e) => !s || e.remark.toLowerCase().includes(s) || e.category.toLowerCase().includes(s) || e.id.toLowerCase().includes(s));
  }, [dq, cat, range, db.expenses.length]);
  const pg = usePaged(rows, 12);
  const cats = Object.entries(m.byCat).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <PageHeader
        title="Expenses"
        sub="Every expense flows into Daily Cash and Profit & Loss."
        crumbs={[['Expenses']]}
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => toast('success', 'Export ready', `${rows.length} expenses exported`)}>
              <Download /> Export
            </button>
            {can('expenses.create') && (
              <button className="btn btn-primary" onClick={() => setParams({ new: '1' })}>
                <Plus /> Add expense
              </button>
            )}
          </>
        }
      />

      <div className="dash-grid" style={{ marginTop: 0, marginBottom: 18 }}>
        <section className="panel" style={{ display: 'flex' }}>
          <div className="ledger-sum ledger-sum--fill" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', flex: 1 }}>
            <div>
              <span>Today</span>
              <strong>{money(sum(db.expenses.filter((e) => isToday(e.date)), (e) => e.amount))}</strong>
              <div className="muted" style={{ fontSize: 12 }}>{db.expenses.filter((e) => isToday(e.date)).length} entries</div>
            </div>
            <div>
              <span>This month</span>
              <strong>{money(m.expenses)}</strong>
              <div className="muted" style={{ fontSize: 12 }}>{cats.length} categories</div>
            </div>
            <div>
              <span>Last month</span>
              <strong>{money(monthTotals(-1).expenses)}</strong>
              <div className="muted" style={{ fontSize: 12 }}>for comparison</div>
            </div>
          </div>
        </section>
        <Panel title="This month by category">
          <div className="cat-bars">
            {cats.slice(0, 4).map(([c, v]) => (
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

      <section className="panel">
        <div className="table-toolbar">
          <div className="input-group">
            <Search />
            <input className="input" placeholder="Search remark or category…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search expenses" />
          </div>
          <Segmented value={range} onChange={setRange} options={[{ value: 'today', label: 'Today' }, { value: 'month', label: 'This month' }, { value: '90', label: '90 days' }]} />
          <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {db.expenseCategories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 13 }}>
            Total <strong className="num" style={{ color: 'var(--ink)' }}>{money(sum(rows, (e) => e.amount))}</strong>
          </span>
        </div>
        {loading ? (
          <SkeletonRows rows={8} cols={5} />
        ) : rows.length === 0 ? (
          <Empty icon={q || cat ? <SearchX /> : <Receipt />} title={q || cat ? 'No expenses match' : 'No expenses in this period'} body="Add an expense to keep Daily Cash accurate." action={can('expenses.create') ? <button className="btn btn-primary" onClick={() => setParams({ new: '1' })}><Plus /> Add expense</button> : undefined} />
        ) : (
          <>
            <div className="table-wrap responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Remark</th>
                    <th>Mode</th>
                    <th>Added by</th>
                    <th className="ta-r">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pg.slice.map((e) => (
                    <tr key={e.id}>
                      <td>
                        {date(e.date)}
                        <div className="id" style={{ fontSize: 11 }}>{e.id}</div>
                      </td>
                      <td>
                        <span className="tag">{e.category}</span>
                      </td>
                      <td style={{ whiteSpace: 'normal' }}>
                        {e.remark}
                        {e.attachment && (
                          <span className="lock-note" style={{ marginLeft: 8 }}>
                            <Paperclip /> {e.attachment}
                          </span>
                        )}
                      </td>
                      <td>{e.mode}</td>
                      <td>{db.staffById(e.by).name}</td>
                      <td className="ta-r num" style={{ fontWeight: 700 }}>
                        {money(e.amount)}
                      </td>
                      <td className="ta-r">
                        {can('expenses.edit_delete') && (
                          <Menu>
                            <button className="menu__item" onClick={() => toast('info', 'Edit expense', 'Opens the expense form pre-filled.')}>
                              <Pencil /> Edit
                            </button>
                            <button className="menu__item danger" onClick={() => setDel(e)}>
                              <Trash2 /> Delete
                            </button>
                          </Menu>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-list">
              {pg.slice.map((e) => (
                <div className="m-card" key={e.id}>
                  <div className="m-card__row">
                    <strong>{e.category}</strong>
                    <strong className="num">{money(e.amount)}</strong>
                  </div>
                  <div className="m-card__row muted" style={{ fontSize: 12 }}>
                    <span>{e.remark}</span>
                    <span>{date(e.date)}</span>
                  </div>
                </div>
              ))}
            </div>
            <Pagination {...pg} noun="expenses" />
          </>
        )}
      </section>

      <AddExpense
        open={params.get('new') === '1'}
        onClose={() => setParams({})}
        onSave={(e) => {
          addExpense({ ...e, by: user.id });
          toast('success', 'Expense added', `${e.category} · ${money(e.amount)}`);
          setParams({});
        }}
      />

      <Confirm
        open={!!del}
        onClose={() => setDel(null)}
        tone="danger"
        icon={<Trash2 />}
        title={`Delete ${del ? money(del.amount) : ''} ${del?.category} expense?`}
        body="It will be removed from Daily Cash and P&L, and kept in Deleted History for audit."
        confirmLabel="Delete expense"
        onConfirm={() => {
          const i = db.expenses.indexOf(del!);
          db.expenses.splice(i, 1);
          db.audit.unshift({ id: `E${Date.now()}`, at: new Date(), actor: user.id, action: 'EXPENSE_DELETED', entity: 'Expense', entityId: del!.id, summary: `${del!.category} expense deleted`, ip: '192.168.1.11', before: { amount: money(del!.amount) }, after: { status: 'Deleted' } });
          touch();
          toast('success', 'Expense deleted', 'Moved to Deleted History');
          setDel(null);
        }}
      />
    </>
  );
}

function AddExpense({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (e: Omit<Expense, 'id' | 'by'>) => void }) {
  const blank = { date: db.TODAY.toISOString().slice(0, 10), amount: '' as number | '', category: '', mode: 'Cash' as PayMode, remark: '', attachment: '' };
  const [f, setF] = useState(blank);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const errs = { amount: !f.amount ? 'Enter the amount' : '', category: !f.category ? 'Choose a category' : '', remark: !f.remark.trim() ? 'Add a short description' : '' };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add expense"
      sub="Recorded against today’s cash unless you change the date"
      foot={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => {
              setSubmitted(true);
              if (Object.values(errs).some(Boolean)) return;
              setBusy(true);
              setTimeout(() => {
                const d = new Date(f.date);
                const now = new Date();
                d.setHours(now.getHours(), now.getMinutes());
                onSave({ date: d, amount: Number(f.amount), category: f.category, mode: f.mode, remark: f.remark.trim(), attachment: f.attachment || undefined });
                setBusy(false);
                setSubmitted(false);
                setF(blank);
              }, 500);
            }}
          >
            {busy && <span className="spinner" />}
            Save expense
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Amount" required className="span-2" error={submitted ? errs.amount : ''} htmlFor="ea">
          <MoneyInput id="ea" xl value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        </Field>
        <Field label="Date" required htmlFor="ed">
          <input id="ed" type="date" className="input" max={db.TODAY.toISOString().slice(0, 10)} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="Category" required error={submitted ? errs.category : ''} htmlFor="ec">
          <select id="ec" className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            <option value="">Select…</option>
            {db.expenseCategories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <div className="field span-2">
          <span className="field__label">Paid by</span>
          <Segmented block value={f.mode} onChange={(v) => setF({ ...f, mode: v })} options={PAY_MODES.map((m) => ({ value: m, label: m === 'Bank' ? 'Bank' : m === 'UPI' ? 'Other UPI' : m }))} />
        </div>
        <Field label="Description" required className="span-2" error={submitted ? errs.remark : ''} htmlFor="er">
          <input id="er" className="input" placeholder="e.g. Printer toner refill" value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} />
        </Field>
        <Field label="Bill / receipt (optional)" className="span-2" hint="PDF, JPG or PNG up to 5 MB">
          <button type="button" className="btn btn-secondary" onClick={() => setF({ ...f, attachment: f.attachment ? '' : 'expense_bill.jpg' })} style={{ justifyContent: 'flex-start', borderStyle: 'dashed', height: 48 }}>
            {f.attachment ? <Paperclip /> : <Upload />}
            {f.attachment ? `${f.attachment} — click to remove` : 'Attach a photo of the bill'}
          </button>
        </Field>
      </div>
    </Drawer>
  );
}
