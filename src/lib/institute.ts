/* Institute identity used on receipts & bills. Editable in Settings.
   PLACEHOLDER contact details — replace with the client's real details. */
export const institute = {
  name: 'Updaate Computers',
  tagline: 'Computer Education & Digital Services',
  address: 'Main Market Road, Your City – 000000',
  phone: '+91 98765 43210',
  email: 'info@updatecomputers.in',
  receiptPrefix: 'RCP',
  receiptHeading: 'Fee Receipt',
  billPrefix: 'SB',
  receiptFooter: 'Fees once paid are non-refundable and non-transferable. Please keep this receipt for your records.',
  billFooter: 'Government fees, if any, are charged at actuals. GST not applicable on these services.',
  billAccountNote: 'Login ID: provided separately. Password: use the secure setup or reset process; it is never printed.',
};

try {
  const saved = JSON.parse(localStorage.getItem('ims.institute') || 'null') as Record<string, unknown> | null;
  if (saved) for (const key of Object.keys(institute) as (keyof typeof institute)[]) {
    if (typeof saved[key] === 'string' && saved[key].length <= 1000) institute[key] = saved[key];
  }
} catch { /* browser storage is optional in the demo */ }

export function saveInstituteSettings(next: typeof institute) {
  Object.assign(institute, next);
  try { localStorage.setItem('ims.institute', JSON.stringify(institute)); } catch { /* storage unavailable */ }
}
