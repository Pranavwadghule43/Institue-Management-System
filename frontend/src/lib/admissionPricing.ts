import type { Money, SubtypeRef } from '../api/types';
import { toPaise } from './format';

export const MAX_ADMISSION_FEE_PAISE = 999_999_999_999;

export function admissionPrice(parentFee: Money | undefined, selected: readonly SubtypeRef[]) {
  const priced = new Map<number, number>();
  for (const subtype of selected) {
    if (subtype.fee != null) priced.set(subtype.id, toPaise(subtype.fee));
  }
  return {
    usesSubtypeFees: priced.size > 0,
    feePaise: priced.size > 0 ? [...priced.values()].reduce((sum, fee) => sum + fee, 0) : toPaise(parentFee),
  };
}
