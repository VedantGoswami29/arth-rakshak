import { randomUUID } from 'node:crypto';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  runBudgetAnalysis,
  runDebtReduction,
  runSavingsStrategy,
} from '../agents/runSpecialists.js';
import {
  BudgetAnalysisSchema,
  DebtReductionSchema,
  SavingsStrategySchema,
} from '../schemas/finance.schema.js';

/**
 * ADK `SequentialAgent(FullAnalysisPipeline)` → Mastra workflow:
 *   Budget Analysis → Savings Strategy → Debt Reduction
 *
 * The accumulating object plays the role of ADK's shared session state: each
 * step receives everything produced so far and adds its own `output_key`.
 * Each step also persists its result to MongoDB, and the next agent's state
 * injector reads the prior outputs from there — exactly as ADK agents read
 * `budget_analysis` / `savings_strategy` from state.
 */
export const PipelineStateSchema = z.object({
  request: z.string(),
  runId: z.string(),
  budget_analysis: BudgetAnalysisSchema.optional(),
  savings_strategy: SavingsStrategySchema.optional(),
  debt_reduction: DebtReductionSchema.optional(),
});

export const budgetStep = createStep({
  id: 'BudgetAnalysisAgent',
  description: 'Analyzes spending and recommends budget improvements.',
  inputSchema: PipelineStateSchema,
  outputSchema: PipelineStateSchema,
  execute: async ({ inputData, requestContext }) => {
    const budget_analysis = await runBudgetAnalysis({
      requestContext,
      request: inputData.request,
      runId: inputData.runId,
    });
    return { ...inputData, budget_analysis };
  },
});

export const savingsStep = createStep({
  id: 'SavingsStrategyAgent',
  description: 'Recommends savings strategy using the budget analysis.',
  inputSchema: PipelineStateSchema,
  outputSchema: PipelineStateSchema,
  execute: async ({ inputData, requestContext }) => {
    const savings_strategy = await runSavingsStrategy({
      requestContext,
      request: inputData.request,
      runId: inputData.runId,
    });
    return { ...inputData, savings_strategy };
  },
});

export const debtStep = createStep({
  id: 'DebtReductionAgent',
  description: 'Builds avalanche and snowball payoff plans.',
  inputSchema: PipelineStateSchema,
  outputSchema: PipelineStateSchema,
  execute: async ({ inputData, requestContext }) => {
    const debt_reduction = await runDebtReduction({
      requestContext,
      request: inputData.request,
      runId: inputData.runId,
    });
    return { ...inputData, debt_reduction };
  },
});

export const fullAnalysisPipeline = createWorkflow({
  id: 'FullAnalysisPipeline',
  description: 'Runs Budget Analysis → Savings Strategy → Debt Reduction in sequence.',
  inputSchema: PipelineStateSchema,
  outputSchema: PipelineStateSchema,
})
  .then(budgetStep)
  .then(savingsStep)
  .then(debtStep)
  .commit();

export const newPipelineInput = (request: string) => ({ request, runId: randomUUID() });
