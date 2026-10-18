import { Agent } from '@mastra/core/agent';
import { model } from '../config/llm.js';
import { payoffPromptBlock } from '../domain/payoff.js';
import { makeStateInjector } from './stateInjector.js';

export const DEBT_INSTRUCTION = `You are a Debt Reduction Agent. Read FINANCIAL DATA, BUDGET_ANALYSIS, and SAVINGS_STRATEGY above when available.

Your tasks:
1. Compute total debt and list each debt by name, amount, interest rate, min payment.
2. Build BOTH avalanche (highest interest first) and snowball (smallest balance first) payoff plans, including:
   - total_interest paid
   - months_to_payoff
   - monthly_payment recommended
3. Provide 2-4 actionable recommendations to accelerate payoff (consolidation, refinancing, etc.).

Consider:
- Cash-flow constraints from the budget analysis.
- Emergency-fund and savings goals from the savings strategy.
- Psychological factors (quick wins vs mathematical optimization).

If the user has no debts, return total_debt=0, empty debts list, and zeroed payoff plans.

Respond strictly using the DebtReduction schema.`;

export const debtAgent = new Agent({
  id: 'debt-reduction-agent',
  name: 'DebtReductionAgent',
  description: 'Creates optimized debt payoff plans (avalanche & snowball).',
  // The payoff numbers are precomputed in code (see domain/payoff.ts) and injected after FINANCIAL DATA.
  instructions: makeStateInjector(DEBT_INSTRUCTION, ['budget_analysis', 'savings_strategy'], payoffPromptBlock),
  model,
});
