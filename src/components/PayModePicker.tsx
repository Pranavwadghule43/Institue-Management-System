import type { PayMode } from '../data/types';
import { PAY_LABEL, PAY_MODES } from '../lib/payModes';

/** Payment-mode selector used at every counter (fees, bills, expenses). Keyboard: arrow keys move, digits 1–6 pick. */
export function PayModePicker({ value, onChange, dense }: { value: PayMode; onChange: (m: PayMode) => void; dense?: boolean }) {
  return (
    <div
      className={`paymodes ${dense ? 'dense' : ''}`}
      role="radiogroup"
      aria-label="Payment mode"
      onKeyDown={(e) => {
        const i = PAY_MODES.indexOf(value);
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') onChange(PAY_MODES[(i + 1) % PAY_MODES.length]);
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') onChange(PAY_MODES[(i - 1 + PAY_MODES.length) % PAY_MODES.length]);
        else if (/^[1-6]$/.test(e.key)) onChange(PAY_MODES[Number(e.key) - 1]);
        else return;
        e.preventDefault();
      }}
    >
      {PAY_MODES.map((m, i) => (
        <button key={m} type="button" role="radio" aria-checked={value === m} tabIndex={value === m ? 0 : -1} className={value === m ? 'is-active' : ''} onClick={() => onChange(m)}>
          <span className="paymodes__key">{i + 1}</span>
          {PAY_LABEL[m]}
        </button>
      ))}
    </div>
  );
}
