import { date, money } from './format';

/** wa.me deep link — opens WhatsApp with a prefilled message; nothing is sent automatically. */
export function waLink(phone: string, text: string) {
  const digits = phone.replace(/\D/g, '');
  const full = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
}

export const INSTITUTE = 'Update Computers';

export function feeReminderText(name: string, amount: number, due: Date, balance: number) {
  return `Dear ${name},\n\nThis is a gentle reminder from ${INSTITUTE} that your fee installment of ${money(amount)} is due on ${date(due)}.\nTotal balance: ${money(balance)}.\n\nPlease visit the institute or pay via UPI. Thank you!`;
}

/* ---- Full documents as WhatsApp text (C-56: wa.me opens the chat; the user presses Send) ----
   WhatsApp formatting: *bold*, _italic_, ```monospace```. */

const line = (label: string, value: string) => `${label}: ${value}`;

export function receiptMessage(r: {
  name: string; studentId: string; course: string; receiptNo: string; at: Date; amount: number; mode: string; paidTillDate: number; netFee: number; balance: number;
}) {
  return [
    `*${INSTITUTE} — Fee Receipt*`,
    '',
    `Dear ${r.name},`,
    'Thank you, we have received your fee payment.',
    '',
    line('Receipt No', r.receiptNo),
    line('Date', date(r.at)),
    line('Student ID', r.studentId),
    line('Course', r.course),
    line('Mode', r.mode),
    '',
    `*Amount received: ${money(r.amount)}*`,
    line('Net course fee', money(r.netFee)),
    line('Paid till date', money(r.paidTillDate)),
    `*Balance: ${money(r.balance)}*`,
    '',
    '_This is a computer-generated receipt._',
  ].join('\n');
}

export function billMessage(b: {
  name: string; billNo: string; jobId: string; at: Date; items: { name: string; qty: number; rate: number }[]; discount: number; total: number; paid: boolean; mode?: string;
}) {
  const rows = b.items.map((i, n) => `${n + 1}. ${i.name}\n   ${i.qty} × ${money(i.rate)} = ${money(i.qty * i.rate)}`);
  const sub = b.items.reduce((t, i) => t + i.qty * i.rate, 0);
  return [
    `*${INSTITUTE} — Service Bill*`,
    '',
    `Dear ${b.name},`,
    b.paid ? 'Thank you for your payment. Your bill details are below.' : 'Please find your bill details below.',
    '',
    line('Bill No', b.billNo),
    line('Date', date(b.at)),
    line('Job ref', b.jobId),
    '',
    ...rows,
    '',
    line('Subtotal', money(sub)),
    ...(b.discount ? [line('Discount', `− ${money(b.discount)}`)] : []),
    `*Grand total: ${money(b.total)}*`,
    b.paid ? `Paid in full${b.mode ? ` by ${b.mode}` : ''}.` : '_Payment pending — please pay the full amount at the counter._',
  ].join('\n');
}
