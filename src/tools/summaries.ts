import type {
  BudgetAnalysis,
  DebtReduction,
  FinancialData,
  SavingsStrategy,
} from '../schemas/finance.schema.js';

/**
 * Compact, model-facing summaries of tool results.
 *
 * The full structured objects are still returned by `execute` (and persisted in MongoDB /
 * shown in the UI cards), but the coach LLM only needs the headline numbers to write its
 * 1–2 sentence reply. Sending the full JSON back through the model — and replaying it
 * from memory on every later turn — is what burns tokens.
 */

const inr = (n: number | null | undefined): string =>
  n == null ? 'n/a' : `₹${Math.round(n).toLocaleString('en-IN')}`;

const clip = (s: string | null | undefined, max = 110): string =>
  !s ? '' : s.length > max ? `${s.slice(0, max - 1)}…` : s;

export function summarizeBudget(b: BudgetAnalysis): string {
  const cats = [...b.spending_categories]
    .sort((x, y) => y.amount - x.amount)
    .slice(0, 3)
    .map((c) => `${c.category} ${inr(c.amount)}${c.percentage != null ? ` (${Math.round(c.percentage)}%)` : ''}`)
    .join(', ');
  const recs = b.recommendations
    .slice(0, 3)
    .map((r) => `${r.category}: ${clip(r.recommendation)}${r.potential_savings != null ? ` (save ${inr(r.potential_savings)}/mo)` : ''}`)
    .join(' | ');
  return `BUDGET card saved. Expenses ${inr(b.total_expenses)}/mo vs income ${inr(b.monthly_income)}. Top: ${cats}. Tips: ${recs}`;
}

export function summarizeSavings(s: SavingsStrategy): string {
  const ef = s.emergency_fund;
  const allocs = s.recommendations
    .slice(0, 3)
    .map((r) => `${r.category} ${inr(r.amount)}/mo`)
    .join(', ');
  return `SAVINGS card saved. Emergency fund target ${inr(ef.recommended_amount)} (current ${inr(ef.current_amount)}; ${clip(ef.current_status, 80)}). Allocations: ${allocs}`;
}

export function summarizeDebt(d: DebtReduction): string {
  const { avalanche: a, snowball: s } = d.payoff_plans;
  const recs = (d.recommendations ?? [])
    .slice(0, 2)
    .map((r) => clip(r.title, 60))
    .join(' | ');
  return (
    `DEBT card saved. Total debt ${inr(d.total_debt)} across ${d.debts.length} debt(s). ` +
    `Avalanche: ${a.months_to_payoff} mo, ${inr(a.total_interest)} interest. ` +
    `Snowball: ${s.months_to_payoff} mo, ${inr(s.total_interest)} interest.` +
    (recs ? ` Tips: ${recs}` : '')
  );
}

export function summarizeFull(r: {
  budget_analysis: BudgetAnalysis;
  savings_strategy: SavingsStrategy;
  debt_reduction: DebtReduction;
}): string {
  return [summarizeBudget(r.budget_analysis), summarizeSavings(r.savings_strategy), summarizeDebt(r.debt_reduction)].join('\n');
}

export function summarizeUpdate(r: { changes: string[]; financial_data: FinancialData }): string {
  const fd = r.financial_data;
  return `Profile updated: ${r.changes.join('; ')}. Now: income ${inr(fd.monthly_income)}, dependants ${fd.dependants}, ${Object.keys(fd.manual_expenses).length} expense categories, ${fd.debts.length} debt(s).`;
}

/** AI SDK tool-result wrapper understood by Mastra's `toModelOutput`. */
export const asModelText = (value: string) => ({ type: 'text' as const, value });
