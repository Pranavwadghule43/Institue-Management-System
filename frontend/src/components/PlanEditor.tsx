// 16 Nov (client): installment dates and amounts are set by hand, at admission and later from the student profile.
// 20 Nov (client): the initial payment comes first, then the installments. When an amount is typed, the
// installments after it are worked out again so the plan still adds up to the balance (e.g. ₹4,000 left,
// first installment ₹1,500 → the other two become ₹1,250 each).
// The server checks the same rules (students.check_plan); this only gives early feedback.
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { MoneyInput } from './ui';
import { date, iso, money, toPaise } from '../lib/format';
import { addMonthsClamped } from '../lib/schedule';

/** `fixed` marks an amount typed by hand; the auto-calculation never changes it. */
export interface PlanRow { due: string; amount: number | ''; fixed?: boolean }

/** Split paise over n rows: multiples of ₹50 when the share allows it, the last row takes the remainder. */
function splitPaise(total: number, n: number): number[] {
  if (n <= 0) return [];
  let per = Math.floor(total / n / 5000) * 5000;
  if (per === 0) per = Math.floor(total / n / 100) * 100;
  if (per === 0) per = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? total - per * (n - 1) : per));
}

/** Even split, as the app always did: multiples of 50, the last installment takes the remainder, one month apart. */
export function evenPlan(count: number, firstDue: string, balance: number): PlanRow[] {
  if (!count || !firstDue || balance <= 0) return [];
  const base = new Date(`${firstDue}T00:00:00`);
  return splitPaise(toPaise(balance), count).map((p, i) => ({ due: iso(addMonthsClamped(base, i)), amount: p / 100 }));
}

/**
 * Work out the amounts that were not typed by hand so the plan adds up to the balance.
 * `edited` is the row just typed in: the rows after it take up the difference; if none of them is free,
 * the free rows before it do. Without `edited`, every free row shares what is left.
 * Returns the same array when nothing needs to change (already adds up, or no free row).
 */
export function rebalance(rows: PlanRow[], balance: number, edited?: number): PlanRow[] {
  const free = rows.map((r, i) => (!r.fixed && i !== edited ? i : -1)).filter((i) => i >= 0);
  let targets = edited == null ? free : free.filter((i) => i > edited);
  if (targets.length === 0 && edited != null) targets = free.filter((i) => i < edited);
  if (targets.length === 0) return rows;
  const total = rows.reduce((t, r) => t + toPaise(r.amount), 0);
  if (total === toPaise(balance) && rows.every((r) => r.amount !== '' && Number(r.amount) > 0)) return rows;
  const kept = rows.reduce((t, r, i) => (targets.includes(i) ? t : t + toPaise(r.amount)), 0);
  const rest = toPaise(balance) - kept;
  const shares = rest > 0 ? splitPaise(rest, targets.length) : targets.map(() => 0);
  return rows.map((r, i) => {
    const k = targets.indexOf(i);
    if (k < 0) return r;
    return { ...r, amount: shares[k] > 0 ? shares[k] / 100 : '' };
  });
}

export function planError(rows: PlanRow[], balance: number, minDate: string): string | null {
  if (rows.length < 1 || rows.length > 8) return 'Choose 1 to 8 installments';
  if (rows.some((r) => !r.due)) return 'Every installment needs a date';
  const total = rows.reduce((t, r) => t + toPaise(r.amount), 0);
  if (total > toPaise(balance)) return `Installments add up to ${money(total / 100)} — more than the ${money(balance)} still to pay. Lower an amount or remove an installment.`;
  if (rows.some((r) => !r.amount || Number(r.amount) <= 0)) {
    return total === toPaise(balance)
      ? `The other installments already add up to ${money(balance)} — remove the empty installment or lower an amount`
      : 'Every installment needs an amount above ₹0';
  }
  if (rows.some((r) => r.due < minDate)) return `Installment dates can’t be before ${date(minDate)}`;
  if (rows.some((r, i) => i > 0 && r.due < rows[i - 1].due)) return 'Put the installments in date order';
  if (total !== toPaise(balance)) return `Installments add up to ${money(total / 100)} — they must add up to ${money(balance)}`;
  return null;
}

export function PlanEditor({ rows, onChange, balance, minDate, error, startNo = 1, paidFirst }: {
  rows: PlanRow[]; onChange: (rows: PlanRow[]) => void; balance: number; minDate: string; error?: string | null; startNo?: number;
  /** Money taken before the installments (initial payment / already received), shown as the first, locked line. */
  paidFirst?: { label: string; amount: number; note?: string };
}) {
  const total = rows.reduce((t, r) => t + toPaise(r.amount), 0);
  const left = (toPaise(balance) - total) / 100;
  const anyFixed = rows.some((r) => r.fixed);
  const setDue = (i: number, due: string) => onChange(rows.map((r, k) => (k === i ? { ...r, due } : r)));
  const setAmount = (i: number, amount: number | '') => {
    const next = rows.map((r, k) => (k === i ? { ...r, amount, fixed: amount !== '' } : r));
    // While the box is empty (mid-typing) leave the others alone.
    onChange(amount === '' ? next : rebalance(next, balance, i));
  };
  const makeAuto = (i: number) => onChange(rebalance(rows.map((r, k) => (k === i ? { ...r, fixed: false } : r)), balance));
  const evenAgain = () => {
    const shares = splitPaise(toPaise(balance), rows.length);
    onChange(rows.map((r, i) => ({ due: r.due, amount: shares[i] / 100 })));
  };
  const add = () => {
    const last = rows[rows.length - 1];
    const due = last ? iso(addMonthsClamped(new Date(`${last.due}T00:00:00`), 1)) : minDate;
    const next = [...rows, { due, amount: '' as const }];
    onChange(rebalance(next, balance));
  };
  const remove = (i: number) => onChange(rebalance(rows.filter((_, k) => k !== i), balance));
  return (
    <div className="plan-editor">
      <p className="plan-editor__hint muted">Type an amount and the installments after it are worked out again, so the plan always adds up to {money(balance)}.</p>
      <table className="table plan-editor__table">
        <thead><tr><th style={{ width: 44 }}>#</th><th>Due date</th><th>Amount</th><th style={{ width: 44 }} /></tr></thead>
        <tbody>
          {paidFirst && paidFirst.amount > 0 && (
            <tr className="plan-editor__paid">
              <td className="muted num">✓</td>
              <td>{paidFirst.label}{paidFirst.note && <span className="muted"> · {paidFirst.note}</span>}</td>
              <td className="num"><strong>{money(paidFirst.amount)}</strong></td>
              <td />
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="muted num">{startNo + i}</td>
              <td><input type="date" className="input" aria-label={`Installment ${startNo + i} due date`} min={minDate} value={r.due} onChange={(e) => setDue(i, e.target.value)} /></td>
              <td>
                <MoneyInput id={`plan-amt-${i}`} value={r.amount} onChange={(v) => setAmount(i, v)} allowPaise />
                <span className="plan-editor__tag">
                  {r.fixed
                    ? <>Set by you · <button type="button" className="link-btn" onClick={() => makeAuto(i)} aria-label={`Work out installment ${startNo + i} automatically`}>auto</button></>
                    : 'Worked out'}
                </span>
              </td>
              <td>
                <button type="button" className="icon-btn sm" aria-label={`Remove installment ${startNo + i}`} disabled={rows.length <= 1} onClick={() => remove(i)}>
                  <Trash2 />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row-between plan-editor__foot">
        <span className="row" style={{ gap: 4 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={add} disabled={rows.length >= 8}><Plus /> Add installment</button>
          {(anyFixed || left !== 0) && rows.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={evenAgain}><RotateCcw /> Split evenly</button>}
        </span>
        <span className={`num ${left === 0 ? 'muted' : ''}`} style={{ fontSize: 13, color: left === 0 ? undefined : 'var(--danger-700)' }}>
          {money(total / 100)} of {money(balance)}{left !== 0 && ` · ${left > 0 ? `${money(left)} still to place` : `${money(-left)} too much`}`}
        </span>
      </div>
      {error && <p className="field__error" role="alert">{error}</p>}
    </div>
  );
}
