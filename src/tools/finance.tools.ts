import { createTool } from '@mastra/core/tools';
import { z, ZodError } from 'zod';
import { REPORT_TYPES } from '../schemas/finance.schema.js';
import {
  runBudgetAnalysis,
  runDebtReduction,
  runSavingsStrategy,
} from '../agents/runSpecialists.js';
import { requireUserId } from '../context/requestContext.js';
import {
  AgentToolInputSchema,
  BudgetAnalysisSchema,
  DebtReductionSchema,
  FullAnalysisOutputSchema,
  SavingsStrategySchema,
  AddDebtsToolInputSchema,
  RemoveDebtsToolInputSchema,
  SetDependantsToolInputSchema,
  SetExpensesToolInputSchema,
  SetIncomeToolInputSchema,
  toDomainPatch,
  UpdateFinancialDataOutputSchema,
  type UpdateFinancialDataToolInput,
} from '../schemas/finance.schema.js';
import { getLatestReport, updateFinancialData } from '../services/finance.service.js';
import { fullAnalysisPipeline, newPipelineInput } from '../workflows/financeWorkflow.js';

import { asModelText, summarizeBudget, summarizeDebt, summarizeFull, summarizeSavings, summarizeUpdate } from './summaries.js';

/**
 * ADK function tool `update_financial_data` → five small Mastra tools (one per action).
 * They all funnel into the same `updateFinancialData` service call, so the business
 * logic is unchanged: alias normalisation, merge semantics for expenses, append for
 * debts, removal by case-insensitive name. `userId` comes from the RequestContext only.
 */
async function applyProfileUpdate(
  toolId: string,
  input: UpdateFinancialDataToolInput,
  context: { requestContext?: Parameters<typeof requireUserId>[0] },
) {
  const userId = requireUserId(context.requestContext);
  let patch;
  try {
    patch = toDomainPatch(input); // enforces ranges the strict LLM schema cannot express
  } catch (err) {
    if (err instanceof ZodError) {
      const detail = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Invalid values for ${toolId} (${detail}). Fix them and call the tool again.`);
    }
    throw err;
  }
  const { changes, financial_data } = await updateFinancialData(userId, patch);
  return { status: 'updated' as const, changes, financial_data };
}

const profileTool = <S extends z.ZodType>(opts: {
  id: string;
  description: string;
  inputSchema: S;
  toPatchInput: (input: z.infer<S>) => UpdateFinancialDataToolInput;
}) =>
  createTool({
    id: opts.id,
    description: opts.description,
    inputSchema: opts.inputSchema,
    outputSchema: UpdateFinancialDataOutputSchema,
    toModelOutput: (out) => asModelText(summarizeUpdate(out)),
    execute: async (input, context) =>
      applyProfileUpdate(opts.id, opts.toPatchInput(input as z.infer<S>), context),
  });

export const setMonthlyIncomeTool = profileTool({
  id: 'set_monthly_income',
  description: "Set the user's monthly take-home income (replaces the existing value).",
  inputSchema: SetIncomeToolInputSchema,
  toPatchInput: ({ amount }) => ({ monthly_income: amount }),
});

export const setDependantsTool = profileTool({
  id: 'set_dependants',
  description: "Set the user's number of dependants (replaces the existing value).",
  inputSchema: SetDependantsToolInputSchema,
  toPatchInput: ({ count }) => ({ dependants: count }),
});

export const setExpensesTool = profileTool({
  id: 'set_expenses',
  description:
    'Set one or more monthly expense categories. Merges into the existing expenses — categories not ' +
    'listed are preserved. Use amount 0 to clear a category.',
  inputSchema: SetExpensesToolInputSchema,
  toPatchInput: ({ expenses }) => ({ expenses_patch: expenses }),
});

export const addDebtsTool = profileTool({
  id: 'add_debts',
  description: "APPEND one or more debts to the user's existing debts (never replaces the list).",
  inputSchema: AddDebtsToolInputSchema,
  toPatchInput: ({ debts }) => ({
    add_debts: debts.map((d) => ({ ...d, min_payment: d.min_payment > 0 ? d.min_payment : null })),
  }),
});

export const removeDebtsTool = profileTool({
  id: 'remove_debts',
  description: 'Remove debts by name (case-insensitive), e.g. after the user paid one off.',
  inputSchema: RemoveDebtsToolInputSchema,
  toPatchInput: ({ names }) => ({ remove_debt_names: names }),
});

const ANALYSIS_FAILED =
  'The analysis could not be completed right now (the AI provider is rate-limited or returned an invalid response). ' +
  'Briefly tell the user, and suggest trying again in about a minute. Do NOT call any tool again in this turn.';

/** Log the real error server-side; give the model a safe message that stops it from retrying in a loop. */
async function guarded<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Unauthenticated')) throw err;
    console.error(`[tool:${label}]`, err instanceof Error ? err.message : err);
    throw new Error(ANALYSIS_FAILED);
  }
}

/**
 * ADK `AgentTool(agent=...)` equivalents. Tool ids equal the ADK agent names so the
 * coach's routing prompt is unchanged. The sub-agent runs with its own fresh context
 * (like AgentTool), shares the caller's RequestContext, and its structured output is
 * persisted as the ADK `output_key` value.
 */
export const runBudgetAnalysisTool = createTool({
  id: 'BudgetAnalysisAgent',
  description:
    'Analyzes financial data to categorize spending patterns and recommend budget improvements.',
  inputSchema: AgentToolInputSchema,
  outputSchema: BudgetAnalysisSchema,
  toModelOutput: (out) => asModelText(summarizeBudget(out)),
  execute: async ({ request }, context) =>
    guarded('BudgetAnalysisAgent', () => runBudgetAnalysis({ requestContext: context.requestContext, request })),
});

export const runSavingsStrategyTool = createTool({
  id: 'SavingsStrategyAgent',
  description:
    'Recommends savings strategies based on income, expenses, and prior budget analysis.',
  inputSchema: AgentToolInputSchema,
  outputSchema: SavingsStrategySchema,
  toModelOutput: (out) => asModelText(summarizeSavings(out)),
  execute: async ({ request }, context) =>
    guarded('SavingsStrategyAgent', () => runSavingsStrategy({ requestContext: context.requestContext, request })),
});

export const runDebtReductionTool = createTool({
  id: 'DebtReductionAgent',
  description: 'Creates optimized debt payoff plans (avalanche & snowball).',
  inputSchema: AgentToolInputSchema,
  outputSchema: DebtReductionSchema,
  toModelOutput: (out) => asModelText(summarizeDebt(out)),
  execute: async ({ request }, context) =>
    guarded('DebtReductionAgent', () => runDebtReduction({ requestContext: context.requestContext, request })),
});

/** ADK `AgentTool(FullAnalysisPipeline)` → runs the Mastra workflow. */
export const runFullAnalysisTool = createTool({
  id: 'FullAnalysisPipeline',
  description: 'Runs Budget Analysis → Savings Strategy → Debt Reduction in sequence.',
  inputSchema: AgentToolInputSchema,
  outputSchema: FullAnalysisOutputSchema,
  toModelOutput: (out) => asModelText(summarizeFull(out)),
  execute: async ({ request }, context) =>
    guarded('FullAnalysisPipeline', async () => {
    requireUserId(context.requestContext); // fail fast before spending tokens

    const workflow = context.mastra?.getWorkflow('fullAnalysisPipeline') ?? fullAnalysisPipeline;
    const run = await workflow.createRun();
    const result = await run.start({
      inputData: newPipelineInput(request?.trim() || 'Run the full financial analysis for the user.'),
      requestContext: context.requestContext,
    });

    if (result.status !== 'success') {
      const detail =
        result.status === 'failed' ? (result.error?.message ?? 'unknown error') : result.status;
      throw new Error(`FullAnalysisPipeline did not complete: ${detail}`);
    }
    const { budget_analysis, savings_strategy, debt_reduction } = result.result;
    if (!budget_analysis || !savings_strategy || !debt_reduction) {
      throw new Error('FullAnalysisPipeline finished without all three reports');
    }
    return { budget_analysis, savings_strategy, debt_reduction };
    }),
});

/**
 * Read-only: lets the coach answer follow-up questions about an analysis that was already
 * run, using the full saved report from MongoDB. (The analysis tools only return a short
 * summary to the model to save tokens.) Never calls a specialist agent — no generation cost.
 */
export const getSavedReportTool = createTool({
  id: 'get_saved_report',
  description:
    "Read the user's most recent saved analysis card in full detail (budget_analysis, savings_strategy " +
    'or debt_reduction). Use ONLY to answer follow-up questions about an analysis that already exists ' +
    '(e.g. "what were the automation tips?"). Does not run a new analysis.',
  inputSchema: z.object({
    report: z.enum(REPORT_TYPES).describe('Which saved report to read'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    report: z.enum(REPORT_TYPES),
    data: z.record(z.string(), z.unknown()).nullable(),
  }),
  toModelOutput: (out) =>
    asModelText(
      out.found
        ? `${out.report} (latest saved): ${JSON.stringify(out.data)}`
        : `No saved ${out.report} yet. Offer to run that analysis.`,
    ),
  execute: async ({ report }, context) => {
    const userId = requireUserId(context.requestContext);
    const data = await getLatestReport(userId, report);
    return { found: data != null, report, data: (data as Record<string, unknown> | null) ?? null };
  },
});
