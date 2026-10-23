import type { Bill, ReceiptSnapshot } from '../api/types';
import { date, money } from './format';

/** wa.me deep link — opens WhatsApp with a prefilled message; nothing is sent automatically. */
export function waLink(phone: string, text: string) {
  const digits = phone.replace(/\D/g, '');
  const full = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
}

export const INSTITUTE = 'Updaate Computers';

export function feeReminderText(name: string, amount: number | string, due: Date | string, balance: number | string) {
  return `Dear ${name},\n\nThis is a gentle reminder from ${INSTITUTE} that your fee installment of ${money(amount)} is due on ${date(due)}.\nTotal balance: ${money(balance)}.\n\nPlease visit the institute or pay via UPI. Thank you!`;
}

/* ---- Full documents as WhatsApp text (C-56: wa.me opens the chat; the user presses Send) ----
   WhatsApp formatting: *bold*, _italic_, ```monospace```. */

const line = (label: string, value: string) => `${label}: ${value}`;

/** Built from the immutable receipt snapshot, so the message matches the printed receipt. */
export function receiptMessage(r: ReceiptSnapshot) {
  return [
    `*${r.institute.name ?? INSTITUTE} — ${r.institute.receipt_heading}*`,
    '',
    `Dear ${r.student.name},`,
    'Thank you, we have received your fee payment.',
    '',
    line('Receipt No', r.receipt_no),
    line('Date', date(r.issued_at)),
    line('Student ID', r.student.code),
    line('Course', `${r.course.code} — ${r.course.name}`),
    line('Mode', r.payment.mode_label),
    '',
    `*Amount received: ${money(r.payment.amount)}*`,
    line('Net course fee', money(r.net_fee)),
    line('Paid till date', money(r.total_paid)),
    `*Balance: ${money(r.balance)}*`,
    '',
    '_This is a computer-generated receipt._',
  ].join('\n');
}

export function billMessage(b: Bill) {
  const rows = b.items.map((i, k) => `${k + 1}. ${i.name}\n   ${i.quantity} × ${money(i.rate)} = ${money(i.line_amount)}`);
  return [
    `*${b.institute.name ?? INSTITUTE} — Service Bill*`,
    '',
    `Dear ${b.customer.name},`,
    b.status === 'Paid' ? 'Thank you for your payment. Your bill details are below.' : 'Please find your bill details below.',
    '',
    line('Bill No', b.code),
    line('Date', date(b.created_at)),
    line('Job ref', b.job.code),
    '',
    ...rows,
    '',
    line('Subtotal', money(b.subtotal)),
    ...(Number(b.discount) ? [line('Discount', `− ${money(b.discount)}`)] : []),
    `*Grand total: ${money(b.grand_total)}*`,
    b.status === 'Paid' ? `Paid in full${b.payment ? ` by ${b.payment.mode_label}` : ''}.` : '_Payment pending — please pay the full amount at the counter._',
  ].join('\n');
}
