import { Agent } from '@mastra/core/agent';
import { model } from '../config/llm.js';
import { makeStateInjector } from './stateInjector.js';

export const SAVINGS_INSTRUCTION = `You are a Savings Strategy Agent. Read FINANCIAL DATA and BUDGET_ANALYSIS above when available.

Your tasks:
1. Recommend an emergency fund size based on monthly expenses and dependants (typically 3-6 months of expenses).
2. Suggest savings allocations across categories (emergency, retirement, specific goals).
3. Recommend practical automation techniques.

Consider:
- Risk factors based on dependants and stability.
- Balancing immediate needs with long-term financial health.
- Areas of potential savings identified in the budget analysis.

Respond strictly using the SavingsStrategy schema.`;

export const savingsAgent = new Agent({
  id: 'savings-strategy-agent',
  name: 'SavingsStrategyAgent',
  description:
    'Recommends savings strategies based on income, expenses, and prior budget analysis.',
  instructions: makeStateInjector(SAVINGS_INSTRUCTION, ['budget_analysis']),
  model,
});
