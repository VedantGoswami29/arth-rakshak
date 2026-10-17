import type { Snapshot } from './types';

export type CardKey = 'profile' | 'budget' | 'savings' | 'debt';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What changed between two snapshots — drives toasts and the card highlight animation. */
export function diffSnapshot(prev: Snapshot, next: Snapshot): { keys: CardKey[]; messages: string[] } {
  const keys: CardKey[] = [];
  const messages: string[] = [];

  const p = prev.financial_data;
  const n = next.financial_data;
  const parts: string[] = [];
  if (p.monthly_income !== n.monthly_income) parts.push('income');
  if (p.dependants !== n.dependants) parts.push('dependants');
  if (!same(p.manual_expenses, n.manual_expenses)) parts.push('expenses');
  if (!same(p.debts, n.debts)) parts.push('debts');
  if (parts.length) {
    keys.push('profile');
    messages.push(`Profile updated (${parts.join(', ')})`);
  }
  if (!same(prev.reports.budget_analysis, next.reports.budget_analysis) && next.reports.budget_analysis) {
    keys.push('budget');
    messages.push('Budget analysis ready');
  }
  if (!same(prev.reports.savings_strategy, next.reports.savings_strategy) && next.reports.savings_strategy) {
    keys.push('savings');
    messages.push('Savings strategy ready');
  }
  if (!same(prev.reports.debt_reduction, next.reports.debt_reduction) && next.reports.debt_reduction) {
    keys.push('debt');
    messages.push('Debt payoff plan ready');
  }
  return { keys, messages };
}
