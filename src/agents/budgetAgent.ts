import { Agent } from '@mastra/core/agent';
import { model } from '../config/llm.js';
import { makeStateInjector } from './stateInjector.js';

export const BUDGET_INSTRUCTION = `You are a Budget Analysis Agent. Read FINANCIAL DATA above.

Your tasks:
1. Categorize ALL expenses from the user's financial data into logical groups, with percentages summing to 100%.
2. Identify spending patterns and trends across categories.
3. Provide 3-5 specific, actionable recommendations with quantified potential monthly savings.

Consider:
- Number of dependants when evaluating household expenses.
- Typical spending ratios for the income level (housing ~30%, food ~15%).
- Essential vs discretionary spending separation.

Respond strictly using the BudgetAnalysis schema.`;

// Output schema (BudgetAnalysisSchema) is applied at call time via `structuredOutput`
// in runSpecialists.ts — Mastra's equivalent of ADK `output_schema` + `output_key`.
export const budgetAgent = new Agent({
  id: 'budget-analysis-agent',
  name: 'BudgetAnalysisAgent',
  description:
    'Analyzes financial data to categorize spending patterns and recommend budget improvements.',
  instructions: makeStateInjector(BUDGET_INSTRUCTION, []),
  model,
});
