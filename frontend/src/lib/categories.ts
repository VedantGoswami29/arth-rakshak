/** Canonical expense categories — must match the backend (src/domain/financial.ts). */
export const EXPENSE_CATEGORIES = ['Housing', 'Utilities', 'Food', 'Transportation', 'Healthcare', 'Entertainment', 'Personal', 'Savings', 'Other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
