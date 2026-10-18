import { z } from 'zod';
import { CANONICAL_EXPENSE_CATEGORIES } from '../domain/financial.js';

/** Request validation for the UI's direct profile editing endpoints. */

const MAX_MONEY = 1_000_000_000_000; // sanity cap, far above any real balance

export const ExpenseCategoryParam = z.enum(CANONICAL_EXPENSE_CATEGORIES);

export const BasicsBodySchema = z
  .object({
    monthly_income: z.number().min(0).max(MAX_MONEY).optional(),
    dependants: z.number().int().min(0).max(100).optional(),
  })
  .refine((v) => v.monthly_income !== undefined || v.dependants !== undefined, {
    message: 'Provide monthly_income and/or dependants',
  });

export const ExpenseBodySchema = z.object({ amount: z.number().min(0).max(MAX_MONEY) });

export const DebtBodySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  amount: z.number().min(0).max(MAX_MONEY),
  interest_rate: z.number().min(0).max(1000),
  min_payment: z.number().min(0).max(MAX_MONEY).nullish(),
});

export const DebtNameParam = z.string().trim().min(1).max(100);
