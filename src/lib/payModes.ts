import type { PayMode } from '../api/types';

/* BR-005: GPay / PhonePe are recorded as their own modes (no payment API).
   Whether reports group them under UPI is still open (17_GAP_ANALYSIS) — kept separate here. */
export const PAY_MODES: PayMode[] = ['Cash', 'GPay', 'PhonePe', 'UPI', 'Card', 'Bank'];

export const PAY_LABEL: Record<PayMode, string> = {
  Cash: 'Cash',
  GPay: 'GPay',
  PhonePe: 'PhonePe',
  UPI: 'Other UPI',
  Card: 'Card',
  Bank: 'Bank transfer',
};

export const isDigital = (m: PayMode) => m === 'GPay' || m === 'PhonePe' || m === 'UPI';
