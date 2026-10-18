import type { Debt, DebtReduction, FinancialData } from '../schemas/finance.schema.js';

/**
 * Deterministic debt-payoff maths.
 *
 * LLMs are slow and unreliable at month-by-month amortisation, and on reasoning models the
 * hidden "thinking" for it can use the entire output budget (finish=length with empty text).
 * So the numbers are computed here and handed to the agent; the model only writes the advice.
 */

export const MAX_MONTHS = 600; // 50 years — beyond this we call it "never"

export interface PlanNumbers {
  total_interest: number;
  months_to_payoff: number;
  monthly_payment: number;
}

/** The debt's own minimum payment, else max($25, 2% of the balance). */
export const assumedMinPayment = (d: Debt): number =>
  d.min_payment != null && d.min_payment > 0 ? d.min_payment : Math.max(25, Math.round(d.amount * 0.02));

const round2 = (n: number): number => Math.round(n * 100) / 100;

function simulate(debts: Debt[], method: 'avalanche' | 'snowball', extra: number): PlanNumbers & { never: boolean } {
  const active = debts
    .filter((d) => d.amount > 0)
    .map((d) => ({ bal: d.amount, r: d.interest_rate / 100 / 12, min: assumedMinPayment(d) }));
  if (active.length === 0) return { total_interest: 0, months_to_payoff: 0, monthly_payment: 0, never: false };

  const budget = active.reduce((s, d) => s + d.min, 0) + Math.max(0, extra); // constant; freed-up minimums roll over
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
    const order = active
      .filter((d) => d.bal > 0)
      .sort((a, b) => (method === 'avalanche' ? b.r - a.r : a.bal - b.bal));
    for (const d of order) {
      if (left <= 0) break;
      const p = Math.min(left, d.bal);
      d.bal -= p;
      left -= p;
    }
  }
  return {
    total_interest: round2(interest),
    months_to_payoff: months,
    monthly_payment: round2(budget),
    never: active.some((d) => d.bal > 0.005),
  };
}

export interface ComputedPlans {
  avalanche: PlanNumbers;
  snowball: PlanNumbers;
  /** true if, at these payments, some debt is not cleared within MAX_MONTHS */
  never: boolean;
}

export function computePayoffPlans(debts: Debt[], extra = 0): ComputedPlans {
  const { never: na, ...avalanche } = simulate(debts, 'avalanche', extra);
  const { never: ns, ...snowball } = simulate(debts, 'snowball', extra);
  return { avalanche, snowball, never: na || ns };
}

export const sumDebt = (debts: Debt[]): number => round2(debts.reduce((s, d) => s + d.amount, 0));

/** Text block injected into the Debt agent's prompt. */
export function payoffPromptBlock(fd: FinancialData): string | null {
  if (fd.debts.length === 0) return null;
  const plans = computePayoffPlans(fd.debts);
  return (
    'PRECOMPUTED_PAYOFF_PLANS (computed in code — exact. Copy these numbers into payoff_plans and do NOT recalculate them):\n' +
    JSON.stringify({ avalanche: plans.avalanche, snowball: plans.snowball }) +
    '\nBasis: minimum payments only (a debt with no minimum assumes the greater of $25 or 2% of its balance); ' +
    'avalanche = highest interest first, snowball = smallest balance first, freed-up payments roll over. ' +
    'Your recommendations may suggest paying extra.' +
    (plans.never ? '\nNote: at these payments at least one debt is NOT paid off within 50 years — say so.' : '')
  );
}

/** Replace the model's payoff numbers with the computed ones (keeps its debts list and advice). */
export function applyComputedPlans(report: DebtReduction, fd: FinancialData): DebtReduction {
  if (fd.debts.length === 0) return report;
  const plans = computePayoffPlans(fd.debts);
  return { ...report, total_debt: sumDebt(fd.debts), payoff_plans: { avalanche: plans.avalanche, snowball: plans.snowball } };
}

/** A complete, valid report built without the model — used when the model keeps failing. */
export function buildFallbackDebtReport(fd: FinancialData): DebtReduction {
  const plans = computePayoffPlans(fd.debts);
  return {
    total_debt: sumDebt(fd.debts),
    debts: fd.debts,
    payoff_plans: { avalanche: plans.avalanche, snowball: plans.snowball },
    recommendations: plans.never
      ? [
          {
            title: 'Your payments do not cover the interest',
            description: 'At the minimum payments, at least one debt never gets paid off. Increase the payment or ask the lender about a lower rate.',
            impact: 'Not paid off within 50 years at current payments',
          },
        ]
      : null,
  };
}
