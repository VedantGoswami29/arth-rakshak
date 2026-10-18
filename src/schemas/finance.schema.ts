import { z } from 'zod';

/* ─────────────────────────────────────────────────────────────────────────
 * Specialist-agent OUTPUT schemas (Pydantic → Zod).
 *
 * Pydantic `Optional[X] = None` is modelled as `.nullable()` (key always
 * present, value may be null). This keeps the JSON Schema compatible with
 * Groq strict structured outputs, which require every property to be listed
 * as required. (Documented behaviour change.)
 * ───────────────────────────────────────────────────────────────────────── */

export const SpendingCategorySchema = z.object({
  category: z.string().describe('Expense category name'),
  amount: z.number().describe('Amount spent in this category'),
  percentage: z.number().nullable().describe('Percentage of total spending'),
});

export const SpendingRecommendationSchema = z.object({
  category: z.string().describe('Category for recommendation'),
  recommendation: z.string().describe('Recommendation details'),
  potential_savings: z.number().nullable().describe('Estimated monthly savings'),
});

export const BudgetAnalysisSchema = z.object({
  total_expenses: z.number().describe('Total monthly expenses'),
  monthly_income: z.number().nullable().describe('Monthly income'),
  spending_categories: z.array(SpendingCategorySchema).describe('Breakdown of spending by category'),
  recommendations: z.array(SpendingRecommendationSchema).describe('Spending recommendations'),
});

export const EmergencyFundSchema = z.object({
  recommended_amount: z.number().describe('Recommended emergency fund size'),
  current_amount: z.number().nullable().describe('Current emergency fund (if any)'),
  current_status: z.string().describe('Status assessment of emergency fund'),
});

export const SavingsRecommendationSchema = z.object({
  category: z.string().describe('Savings category'),
  amount: z.number().describe('Recommended monthly amount'),
  rationale: z.string().nullable().describe('Explanation for this recommendation'),
});

export const AutomationTechniqueSchema = z.object({
  name: z.string().describe('Name of automation technique'),
  description: z.string().describe('Details of how to implement'),
});

export const SavingsStrategySchema = z.object({
  emergency_fund: EmergencyFundSchema.describe('Emergency fund recommendation'),
  recommendations: z.array(SavingsRecommendationSchema).describe('Savings allocation recommendations'),
  automation_techniques: z
    .array(AutomationTechniqueSchema)
    .nullable()
    .describe('Automation techniques to help save'),
});

export const DebtSchema = z.object({
  name: z.string().describe('Name of debt'),
  amount: z.number().describe('Current balance'),
  interest_rate: z.number().describe('Annual interest rate (%)'),
  min_payment: z.number().nullable().describe('Minimum monthly payment'),
});

export const PayoffPlanSchema = z.object({
  total_interest: z.number().describe('Total interest paid'),
  months_to_payoff: z.number().describe('Months until debt-free (whole number)'),
  monthly_payment: z.number().nullable().describe('Recommended monthly payment'),
});

export const PayoffPlansSchema = z.object({
  avalanche: PayoffPlanSchema.describe('Highest interest first method'),
  snowball: PayoffPlanSchema.describe('Smallest balance first method'),
});

export const DebtRecommendationSchema = z.object({
  title: z.string().describe('Title of recommendation'),
  description: z.string().describe('Details of recommendation'),
  impact: z.string().nullable().describe('Expected impact of this action'),
});

export const DebtReductionSchema = z.object({
  total_debt: z.number().describe('Total debt amount'),
  debts: z.array(DebtSchema).describe('List of all debts'),
  payoff_plans: PayoffPlansSchema.describe('Debt payoff strategies'),
  recommendations: z
    .array(DebtRecommendationSchema)
    .nullable()
    .describe('Recommendations for debt reduction'),
});

export type BudgetAnalysis = z.infer<typeof BudgetAnalysisSchema>;
export type SavingsStrategy = z.infer<typeof SavingsStrategySchema>;
export type DebtReduction = z.infer<typeof DebtReductionSchema>;
export type Debt = z.infer<typeof DebtSchema>;

/* ─────────────────────────────────────────────────────────────────────────
 * Report registry — the ADK `output_key` values, used for MongoDB persistence.
 * ───────────────────────────────────────────────────────────────────────── */

export const REPORT_TYPES = ['budget_analysis', 'savings_strategy', 'debt_reduction'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_SCHEMAS = {
  budget_analysis: BudgetAnalysisSchema,
  savings_strategy: SavingsStrategySchema,
  debt_reduction: DebtReductionSchema,
} as const satisfies Record<ReportType, z.ZodType>;

export type ReportDataMap = {
  budget_analysis: BudgetAnalysis;
  savings_strategy: SavingsStrategy;
  debt_reduction: DebtReduction;
};

/* ─────────────────────────────────────────────────────────────────────────
 * Financial profile ("financial_data" in the ADK shared state).
 * ───────────────────────────────────────────────────────────────────────── */

export const FinancialDataSchema = z.object({
  monthly_income: z.number(),
  dependants: z.number().int(),
  manual_expenses: z.record(z.string(), z.number()),
  debts: z.array(DebtSchema),
});
export type FinancialData = z.infer<typeof FinancialDataSchema>;

/* ─────────────────────────────────────────────────────────────────────────
 * Tool schemas
 * ───────────────────────────────────────────────────────────────────────── */

/** Constrained DOMAIN patch for `update_financial_data` (append/merge semantics). Not sent to the LLM. */
export const DebtInputSchema = z.object({
  name: z.string().trim().min(1).max(100).describe('Name of the debt, e.g. "Student loan"'),
  amount: z.number().min(0).describe('Current balance in INR'),
  interest_rate: z.number().min(0).max(1000).describe('Annual interest rate (%)'),
  min_payment: z.number().min(0).nullish().describe('Minimum monthly payment in INR (optional)'),
});

export const UpdateFinancialDataInputSchema = z.object({
  monthly_income: z
    .number()
    .min(0)
    .nullish()
    .describe('New monthly take-home income in INR. Replaces the existing value.'),
  dependants: z
    .number()
    .int()
    .min(0)
    .nullish()
    .describe('New number of dependants. Replaces the existing value.'),
  expenses_patch: z
    .record(z.string(), z.number().min(0))
    .nullish()
    .describe(
      'Partial map of expense category to monthly INR amount. Merges into manual_expenses ' +
        '(existing keys not in the patch are preserved). To zero a category, pass it as 0.',
    ),
  add_debts: z
    .array(DebtInputSchema)
    .nullish()
    .describe(
      'List of debts to APPEND to the existing debts list. Each item must include name, amount, ' +
        'interest_rate, and optionally min_payment.',
    ),
  remove_debt_names: z
    .array(z.string())
    .nullish()
    .describe('List of debt names to remove from the debts list (case-insensitive match).'),
});
export type UpdateFinancialDataInput = z.infer<typeof UpdateFinancialDataInputSchema>;

/**
 * LLM-FACING input of `update_financial_data`.
 *
 * Groq validates tool calls server-side against this JSON Schema in strict mode, which requires:
 *   - every property listed as required (so "optional" = nullable → the model sends null),
 *   - no free-form maps (additionalProperties must be false → expenses are a LIST of items),
 *   - no value constraints (min/max are enforced afterwards by `UpdateFinancialDataInputSchema`).
 */
export const ExpenseItemSchema = z.object({
  category: z
    .string()
    .describe('Expense category. Prefer: Housing, Utilities, Food, Transportation, Healthcare, Entertainment, Personal, Savings, Other.'),
  amount: z.number().describe('Monthly amount in INR (0 to clear the category).'),
});

export const DebtToolInputSchema = z.object({
  name: z.string().describe('Name of the debt, e.g. "Student loan"'),
  amount: z.number().describe('Current balance in INR'),
  interest_rate: z.number().describe('Annual interest rate (%)'),
  min_payment: z.number().nullish().describe('Minimum monthly payment in INR. Omit if unknown.'),
});

export const UpdateFinancialDataToolInputSchema = z.object({
  monthly_income: z
    .number()
    .nullish()
    .describe('New monthly take-home income in INR (replaces the existing value). Omit if not changing.'),
  dependants: z
    .number()
    .nullish()
    .describe('New number of dependants, a whole number (replaces the existing value). Omit if not changing.'),
  expenses_patch: z
    .array(ExpenseItemSchema)
    .nullish()
    .describe(
      'Expense categories to set, e.g. [{"category":"Housing","amount":300}]. Merges into the existing ' +
        'expenses (categories not listed are preserved). To zero a category, set its amount to 0. Omit if no expense changed.',
    ),
  add_debts: z
    .array(DebtToolInputSchema)
    .nullish()
    .describe('Debts to APPEND to the existing debts list. Omit if none are being added.'),
  remove_debt_names: z
    .array(z.string())
    .nullish()
    .describe('Names of debts to remove (case-insensitive match). Omit if none.'),
});
export type UpdateFinancialDataToolInput = z.infer<typeof UpdateFinancialDataToolInputSchema>;

/** Convert the strict LLM-facing shape into the constrained domain patch, validating all values. */
export function toDomainPatch(input: UpdateFinancialDataToolInput): UpdateFinancialDataInput {
  const expenses: Record<string, number> = {};
  for (const item of input.expenses_patch ?? []) {
    const key = item.category.trim();
    expenses[key] = (expenses[key] ?? 0) + item.amount; // same raw key twice → summed (like alias aggregation)
  }
  return UpdateFinancialDataInputSchema.parse({
    monthly_income: input.monthly_income ?? null,
    dependants: input.dependants ?? null,
    expenses_patch: Object.keys(expenses).length > 0 ? expenses : null,
    add_debts: input.add_debts ?? null,
    remove_debt_names: input.remove_debt_names ?? null,
  });
}

export const UpdateFinancialDataOutputSchema = z.object({
  status: z.literal('updated'),
  changes: z.array(z.string()),
  financial_data: FinancialDataSchema,
});

/** Input shared by the sub-agent tools (ADK AgentTool exposes a single `request` string). */
export const AgentToolInputSchema = z.object({
  request: z
    .string()
    .nullable()
    .describe('A short natural-language request describing what analysis is wanted, or null.'),
});

export const FullAnalysisOutputSchema = z.object({
  budget_analysis: BudgetAnalysisSchema,
  savings_strategy: SavingsStrategySchema,
  debt_reduction: DebtReductionSchema,
});
export type FullAnalysis = z.infer<typeof FullAnalysisOutputSchema>;

/* ─────────────────────────────────────────────────────────────────────────
 * HTTP API
 * ───────────────────────────────────────────────────────────────────────── */

export const ChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  /** Client-side conversation id. It is namespaced by userId server-side. */
  threadId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .default('default'),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/* ─────────────────────────────────────────────────────────────────────────
 * Profile tools — one small tool per action.
 *
 * Mastra rewrites every tool schema sent to Groq so that ALL properties are
 * "required" (optional → required-nullable). One tool with five optional arguments
 * therefore makes small models fail Groq's tool-call validation whenever they omit
 * an unused argument. Each tool below has only arguments that are naturally required.
 * ───────────────────────────────────────────────────────────────────────── */

export const SetIncomeToolInputSchema = z.object({
  amount: z.number().describe('Monthly take-home income in INR, e.g. 50000'),
});

export const SetDependantsToolInputSchema = z.object({
  count: z.number().describe('Number of dependants as a whole number, e.g. 2'),
});

export const SetExpensesToolInputSchema = z.object({
  expenses: z
    .array(ExpenseItemSchema)
    .describe('Monthly expenses to set, e.g. [{"category":"Housing","amount":300}]. Other categories are preserved.'),
});

export const AddDebtsToolInputSchema = z.object({
  debts: z
    .array(
      z.object({
        name: z.string().describe('Name of the debt, e.g. "Student loan"'),
        amount: z.number().describe('Current balance in INR'),
        interest_rate: z.number().describe('Annual interest rate in percent, e.g. 5 for 5%'),
        min_payment: z.number().describe('Minimum monthly payment in INR; use 0 if unknown or none'),
      }),
    )
    .describe('Debts to APPEND to the existing list'),
});

export const RemoveDebtsToolInputSchema = z.object({
  names: z.array(z.string()).describe('Names of the debts to remove (case-insensitive), e.g. ["Car loan"]'),
});
