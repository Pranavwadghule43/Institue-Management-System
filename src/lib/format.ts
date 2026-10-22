const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrPaise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
const num = new Intl.NumberFormat('en-IN');

/** ₹1,24,500 — Indian digit grouping */
export const money = (n: number, paise = false) => (paise ? inrPaise : inr).format(n);

/** ₹1.24L / ₹2.3Cr / ₹48.5K — for compact axis labels */
export function moneyShort(n: number) {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${+(n / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `₹${+(n / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `₹${+(n / 1e3).toFixed(1)}K`;
  return `₹${n}`;
}

export const count = (n: number) => num.format(n);

const d1 = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const d2 = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' });
const t1 = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
const wd = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const date = (d: Date) => d1.format(d);
export const dateShort = (d: Date) => d2.format(d);
export const time = (d: Date) => t1.format(d).toUpperCase();
export const dateTime = (d: Date) => `${d1.format(d)}, ${time(d)}`;
export const longDate = (d: Date) => wd.format(d);

export function relDays(d: Date, today = new Date()) {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diff = Math.round((a - b) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

export function daysBetween(a: Date, b: Date) {
  const x = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const y = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((y - x) / 86400000);
}

export function ago(d: Date, now = new Date()) {
  const s = Math.max(0, (now.getTime() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return relDays(d, now);
}

export function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

const AV = ['#2a5c9e', '#3a6f8f', '#4b4a8a', '#3f7266', '#8a5a34', '#6a4f86', '#55708f', '#8a4b5c', '#4f6b3a', '#5c6575'];
export function avatarColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AV[h % AV.length];
}

/** Mask all but the last 4 digits (Aadhaar / phone in broad views) */
export const mask = (s: string) => s.slice(0, -4).replace(/\d/g, '•') + s.slice(-4);

/** Indian-system amount in words — for receipts */
export function amountInWords(n: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x: number) => (x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? ' ' + ones[x % 10] : ''}`);
  const three = (x: number) => {
    const h = Math.floor(x / 100);
    const r = x % 100;
    return [h ? `${ones[h]} Hundred` : '', r ? two(r) : ''].filter(Boolean).join(' ');
  };
  n = Math.round(n);
  if (n === 0) return 'Zero Rupees Only';
  const crore = Math.floor(n / 1e7);
  const lakh = Math.floor((n % 1e7) / 1e5);
  const thousand = Math.floor((n % 1e5) / 1e3);
  const rest = n % 1000;
  const parts = [
    crore ? `${two(crore)} Crore` : '',
    lakh ? `${two(lakh)} Lakh` : '',
    thousand ? `${two(thousand)} Thousand` : '',
    rest ? three(rest) : '',
  ].filter(Boolean);
  return `Rupees ${parts.join(' ')} Only`;
}

export const pct = (a: number, b: number) => (b <= 0 ? 0 : Math.round((a / b) * 100));
