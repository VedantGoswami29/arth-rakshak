import type { Debt } from './types';

export interface PayoffResult {
  months: number;
  interest: number;
  /** true if the debts are not paid off within MAX_MONTHS at this payment level */
  never: boolean;
}

const MAX_MONTHS = 600;

/** Minimum payment used by the simulator: the user's value, else max(₹500, 2% of balance). */
export function assumedMin(d: Debt): number {
  return d.min_payment != null && d.min_payment > 0 ? d.min_payment : Math.max(500, Math.round(d.amount * 0.02));
}

/**
 * Client-side estimate (avalanche order). Every month: interest accrues, minimums are paid on
 * each debt, and the rest of a constant budget (sum of minimums + `extra`) goes to the
 * highest-rate debt. Freed-up minimums roll over. Used only for the interactive "what if" slider;
 * the authoritative plans still come from the coach's reports.
 */
export function simulatePayoff(debts: Debt[], extra: number): PayoffResult {
  const active = debts
    .filter((d) => d.amount > 0)
    .map((d) => ({ bal: d.amount, r: d.interest_rate / 100 / 12, min: assumedMin(d) }));
  if (active.length === 0) return { months: 0, interest: 0, never: false };

  const budget = active.reduce((s, d) => s + d.min, 0) + Math.max(0, extra);
  let months = 0;
  let interest = 0;

  while (active.some((d) => d.bal > 0.005) && months < MAX_MONTHS) {
    months++;
    for (const d of active) {
      if (d.bal <= 0) continue;
      const i = d.bal * d.r;
      d.bal += i;
      interest += i;
    }
    let left = budget;
    for (const d of active) {
      if (d.bal <= 0) continue;
      const p = Math.min(d.min, d.bal, left);
      d.bal -= p;
      left -= p;
    }
    for (const d of active.filter((x) => x.bal > 0).sort((a, b) => b.r - a.r)) {
      if (left <= 0) break;
      const p = Math.min(left, d.bal);
      d.bal -= p;
      left -= p;
    }
  }
  return { months, interest, never: active.some((d) => d.bal > 0.005) };
}
