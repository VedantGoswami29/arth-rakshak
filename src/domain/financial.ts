import type { Debt, FinancialData, UpdateFinancialDataInput } from '../schemas/finance.schema.js';

/**
 * Pure business logic ported 1:1 from the Python tools
 * (`_normalize_category`, `_ensure_financial_data`, `update_financial_data`).
 * No I/O in this file.
 */

export const CANONICAL_EXPENSE_CATEGORIES = [
  'Housing',
  'Utilities',
  'Food',
  'Transportation',
  'Healthcare',
  'Entertainment',
  'Personal',
  'Savings',
  'Other',
] as const;

export type ExpenseCategory = (typeof CANONICAL_EXPENSE_CATEGORIES)[number];

// Lowercase alias → canonical category. Unknown inputs fall through to "Other".
const EXPENSE_ALIASES: Record<string, ExpenseCategory> = {
  housing: 'Housing',
  rent: 'Housing',
  mortgage: 'Housing',
  home: 'Housing',
  utilities: 'Utilities',
  utility: 'Utilities',
  electric: 'Utilities',
  electricity: 'Utilities',
  internet: 'Utilities',
  phone: 'Utilities',
  water: 'Utilities',
  gas_bill: 'Utilities',
  food: 'Food',
  groceries: 'Food',
  grocery: 'Food',
  dining: 'Food',
  restaurants: 'Food',
  transportation: 'Transportation',
  transport: 'Transportation',
  car: 'Transportation',
  gas: 'Transportation',
  fuel: 'Transportation',
  transit: 'Transportation',
  healthcare: 'Healthcare',
  health: 'Healthcare',
  medical: 'Healthcare',
  insurance: 'Healthcare',
  entertainment: 'Entertainment',
  fun: 'Entertainment',
  subscriptions: 'Entertainment',
  streaming: 'Entertainment',
  personal: 'Personal',
  clothing: 'Personal',
  personal_care: 'Personal',
  savings: 'Savings',
  investing: 'Savings',
  retirement: 'Savings',
  other: 'Other',
  misc: 'Other',
  miscellaneous: 'Other',
};

const ALIAS_LOOKUP = new Map<string, ExpenseCategory>(Object.entries(EXPENSE_ALIASES));

export function createDefaultFinancialData(): FinancialData {
  return { monthly_income: 0, dependants: 0, manual_expenses: {}, debts: [] };
}

/** Map a free-form expense key to a canonical category label. */
export function normalizeCategory(key: string): ExpenseCategory {
  if (!key) return 'Other';
  const cleaned = key.trim().replace(/-/g, '_').replace(/ /g, '_').toLowerCase();
  const alias = ALIAS_LOOKUP.get(cleaned);
  if (alias) return alias;
  for (const canonical of CANONICAL_EXPENSE_CATEGORIES) {
    if (cleaned === canonical.toLowerCase()) return canonical;
  }
  return 'Other';
}

const fmtMoney = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/**
 * Apply an `update_financial_data` patch to a profile and describe what changed.
 * Same semantics as the Python tool: income/dependants replace, expenses merge
 * (aggregating aliases that map to the same canonical category inside one patch),
 * debts append, then removals by case-insensitive name.
 * Never mutates its input.
 */
export function applyFinancialPatch(
  current: FinancialData,
  patch: UpdateFinancialDataInput,
): { financialData: FinancialData; changes: string[] } {
  const fd: FinancialData = {
    monthly_income: current.monthly_income,
    dependants: current.dependants,
    manual_expenses: { ...current.manual_expenses },
    debts: current.debts.map((d) => ({ ...d })),
  };
  const changes: string[] = [];

  if (patch.monthly_income != null) {
    fd.monthly_income = Number(patch.monthly_income);
    changes.push(`income → $${fmtMoney(fd.monthly_income)}`);
  }

  if (patch.dependants != null) {
    fd.dependants = Math.trunc(Number(patch.dependants));
    changes.push(`dependants → ${fd.dependants}`);
  }

  if (patch.expenses_patch && Object.keys(patch.expenses_patch).length > 0) {
    const normalized: Record<string, number> = {};
    for (const [k, v] of Object.entries(patch.expenses_patch)) {
      const canonical = normalizeCategory(k);
      normalized[canonical] = (normalized[canonical] ?? 0) + Number(v);
    }
    for (const [k, v] of Object.entries(normalized)) {
      fd.manual_expenses[k] = v;
    }
    const patchPretty = Object.entries(normalized)
      .map(([k, v]) => `${k}=$${fmtMoney(v)}`)
      .join(', ');
    changes.push(`expenses {${patchPretty}}`);
  }

  if (patch.add_debts && patch.add_debts.length > 0) {
    for (const d of patch.add_debts) {
      const debt: Debt = {
        name: String(d.name || 'Debt'),
        amount: Number(d.amount || 0),
        interest_rate: Number(d.interest_rate || 0),
        min_payment: d.min_payment != null ? Number(d.min_payment) : null,
      };
      fd.debts.push(debt);
    }
    const addedPretty = patch.add_debts
      .map((d) => `${d.name || 'Debt'} ($${fmtMoney(Number(d.amount || 0))} @ ${Number(d.interest_rate || 0)}%)`)
      .join(', ');
    changes.push(`+${patch.add_debts.length} debt(s): ${addedPretty}`);
  }

  if (patch.remove_debt_names && patch.remove_debt_names.length > 0) {
    const targets = new Set(
      patch.remove_debt_names.filter((n) => n).map((n) => n.trim().toLowerCase()),
    );
    const before = fd.debts.length;
    fd.debts = fd.debts.filter((d) => !targets.has(d.name.trim().toLowerCase()));
    const removed = before - fd.debts.length;
    if (removed > 0) {
      changes.push(`-${removed} debt(s) removed: ${patch.remove_debt_names.join(', ')}`);
    }
  }

  return { financialData: fd, changes };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Direct-edit operations (used by the UI's profile editor, not by the LLM).
 * Same shape as `applyFinancialPatch`: pure, never mutate, return what changed.
 * ───────────────────────────────────────────────────────────────────────── */

export class ProfileOpError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'DUPLICATE',
    message: string,
  ) {
    super(message);
    this.name = 'ProfileOpError';
  }
}

const debtKey = (name: string): string => name.trim().toLowerCase();

const cloneFd = (fd: FinancialData): FinancialData => ({
  monthly_income: fd.monthly_income,
  dependants: fd.dependants,
  manual_expenses: { ...fd.manual_expenses },
  debts: fd.debts.map((d) => ({ ...d })),
});

export interface DebtDraft {
  name: string;
  amount: number;
  interest_rate: number;
  min_payment?: number | null;
}

const toDebt = (d: DebtDraft): Debt => ({
  name: d.name.trim(),
  amount: d.amount,
  interest_rate: d.interest_rate,
  min_payment: d.min_payment ?? null,
});

/** Delete one expense category (as opposed to setting it to 0, which keeps the key). */
export function removeExpenseCategory(current: FinancialData, category: string) {
  const key = normalizeCategory(category);
  if (!(key in current.manual_expenses)) throw new ProfileOpError('NOT_FOUND', `No "${key}" expense to delete`);
  const fd = cloneFd(current);
  delete fd.manual_expenses[key];
  return { financialData: fd, changes: [`-expense ${key}`] };
}

/** Add a debt; unlike the chat tool (append-only) the UI refuses a name that already exists. */
export function addDebtUnique(current: FinancialData, draft: DebtDraft) {
  const debt = toDebt(draft);
  if (current.debts.some((d) => debtKey(d.name) === debtKey(debt.name))) {
    throw new ProfileOpError('DUPLICATE', `A debt named "${debt.name}" already exists — edit it instead`);
  }
  const fd = cloneFd(current);
  fd.debts.push(debt);
  return { financialData: fd, changes: [`+debt ${debt.name}`] };
}

/** Replace the (first) debt called `name`; renaming onto another debt's name is refused. */
export function replaceDebt(current: FinancialData, name: string, draft: DebtDraft) {
  const idx = current.debts.findIndex((d) => debtKey(d.name) === debtKey(name));
  if (idx < 0) throw new ProfileOpError('NOT_FOUND', `No debt named "${name}"`);
  const next = toDebt(draft);
  if (current.debts.some((d, i) => i !== idx && debtKey(d.name) === debtKey(next.name))) {
    throw new ProfileOpError('DUPLICATE', `A debt named "${next.name}" already exists`);
  }
  const fd = cloneFd(current);
  fd.debts[idx] = next;
  return { financialData: fd, changes: [`~debt ${next.name}`] };
}

/** Remove the (first) debt called `name`. */
export function removeDebtByName(current: FinancialData, name: string) {
  const idx = current.debts.findIndex((d) => debtKey(d.name) === debtKey(name));
  if (idx < 0) throw new ProfileOpError('NOT_FOUND', `No debt named "${name}"`);
  const fd = cloneFd(current);
  fd.debts.splice(idx, 1);
  return { financialData: fd, changes: [`-debt ${current.debts[idx]?.name ?? name}`] };
}
