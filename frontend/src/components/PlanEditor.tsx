// 16 Nov (client): installment dates and amounts are set by hand, at admission and later from the student profile.
// The server checks the same rules (students.check_plan); this only gives early feedback.
import { Plus, Trash2 } from 'lucide-react';
import { MoneyInput } from './ui';
import { date, iso, money } from '../lib/format';
import { addMonthsClamped } from '../lib/schedule';

export interface PlanRow { due: string; amount: number | '' }

/** Even split, as the app always did: multiples of 50, the last installment takes the remainder, one month apart. */
export function evenPlan(count: number, firstDue: string, balance: number): PlanRow[] {
  if (!count || !firstDue || balance <= 0) return [];
  const per = Math.floor(balance / count / 50) * 50;
  const base = new Date(`${firstDue}T00:00:00`);
  return Array.from({ length: count }, (_, i) => ({
    due: iso(addMonthsClamped(base, i)),
    amount: i === count - 1 ? balance - per * (count - 1) : per,
  }));
}

export function planError(rows: PlanRow[], balance: number, minDate: string): string | null {
  if (rows.length < 1 || rows.length > 8) return 'Choose 1 to 8 installments';
  if (rows.some((r) => !r.due)) return 'Every installment needs a date';
  if (rows.some((r) => !r.amount || Number(r.amount) <= 0)) return 'Every installment needs an amount above ₹0';
  if (rows.some((r) => r.due < minDate)) return `Installment dates can’t be before ${date(minDate)}`;
  if (rows.some((r, i) => i > 0 && r.due < rows[i - 1].due)) return 'Put the installments in date order';
  const total = rows.reduce((t, r) => t + Number(r.amount || 0), 0);
  if (total !== balance) return `Installments add up to ${money(total)} — they must add up to ${money(balance)}`;
  return null;
}

export function PlanEditor({ rows, onChange, balance, minDate, error, startNo = 1 }: {
  rows: PlanRow[]; onChange: (rows: PlanRow[]) => void; balance: number; minDate: string; error?: string | null; startNo?: number;
}) {
  const total = rows.reduce((t, r) => t + Number(r.amount || 0), 0);
  const left = balance - total;
  const set = (i: number, patch: Partial<PlanRow>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const add = () => {
    const last = rows[rows.length - 1];
    const due = last ? iso(addMonthsClamped(new Date(`${last.due}T00:00:00`), 1)) : minDate;
    onChange([...rows, { due, amount: left > 0 ? left : '' }]);
  };
  return (
    <div className="plan-editor">
      <table className="table plan-editor__table">
        <thead><tr><th style={{ width: 44 }}>#</th><th>Due date</th><th>Amount</th><th style={{ width: 44 }} /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="muted num">{startNo + i}</td>
              <td><input type="date" className="input" aria-label={`Installment ${startNo + i} due date`} min={minDate} value={r.due} onChange={(e) => set(i, { due: e.target.value })} /></td>
              <td><MoneyInput id={`plan-amt-${i}`} value={r.amount} onChange={(v) => set(i, { amount: v })} /></td>
              <td>
                <button type="button" className="icon-btn sm" aria-label={`Remove installment ${startNo + i}`} disabled={rows.length <= 1} onClick={() => onChange(rows.filter((_, k) => k !== i))}>
                  <Trash2 />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row-between plan-editor__foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={add} disabled={rows.length >= 8}><Plus /> Add installment</button>
        <span className={`num ${left === 0 ? 'muted' : ''}`} style={{ fontSize: 13, color: left === 0 ? undefined : 'var(--danger-700)' }}>
          {money(total)} of {money(balance)}{left !== 0 && ` · ${left > 0 ? `${money(left)} still to place` : `${money(-left)} too much`}`}
        </span>
      </div>
      {error && <p className="field__error" role="alert">{error}</p>}
    </div>
  );
}
