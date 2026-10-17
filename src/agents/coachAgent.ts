import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { env } from '../config/env.js';
import { coachProviderOptions, model } from '../config/llm.js';
import { tryGetUserId } from '../context/requestContext.js';
import { ensureFinancialProfile } from '../services/finance.service.js';
import {
  runBudgetAnalysisTool,
  runDebtReductionTool,
  getSavedReportTool,
  runFullAnalysisTool,
  runSavingsStrategyTool,
  addDebtsTool,
  removeDebtsTool,
  setDependantsTool,
  setExpensesTool,
  setMonthlyIncomeTool,
} from '../tools/finance.tools.js';

export const COACH_INSTRUCTION = `You are a friendly, concise AI Financial Coach. You collaborate with the user via chat while their structured financial profile and analysis cards live on a side panel.

You have these tools:
- set_monthly_income — set the user's monthly income.
- set_dependants — set the number of dependants.
- set_expenses — set one or more monthly expense categories (merges with existing ones).
- add_debts — APPEND one or more debts.
- remove_debts — remove debts by name.
- BudgetAnalysisAgent — produce a fresh budget breakdown card.
- SavingsStrategyAgent — produce a fresh savings strategy card.
- DebtReductionAgent — produce a fresh debt-payoff plan card.
- FullAnalysisPipeline — run all three in sequence.
- get_saved_report — read the full detail of an analysis card that already exists (only for follow-up questions; it never runs a new analysis).

When calling set_expenses (a list of {category, amount} items), ONLY use these canonical category names (the backend will also normalize aliases like "rent"→"Housing", but prefer canonicals):
Housing, Utilities, Food, Transportation, Healthcare, Entertainment, Personal, Savings, Other.
Map terms intelligently: rent/mortgage → Housing; groceries/dining → Food; gas/car/transit → Transportation; subscriptions/streaming → Entertainment; medical/insurance → Healthcare; clothing/personal_care → Personal; investing/retirement → Savings.

Routing rules — pick the SMALLEST tool that satisfies the request:
1. If the user states a fact about their finances (e.g. "my income is $8k", "my rent is $2400", "I just paid off the car loan", "add a $500 student loan at 5%"), call the matching profile tool(s) with only the facts they mentioned. To add a new debt, use add_debts (which appends). To remove a paid-off debt, use remove_debts. Never overwrite the entire profile.
2. If the user asks for a specific report ("analyze my budget", "what should I save?", "plan my debt payoff"), call the matching single tool.
3. If the user asks for a full review ("analyze my finances", "give me the full picture", "run a full review"), call FullAnalysisPipeline.
4. If the user asks a general question or chats, just answer in plain text — DO NOT call a tool. If they ask for details of an analysis already shown, use get_saved_report instead of re-running it.
5. Never call multiple tools in the same turn unless explicitly asked — except that you may call several profile tools in one turn when the message states several facts (e.g. income and rent). Never call an analysis tool to confirm a profile update.

After a tool call:
- For profile tools: reply in 1 short sentence confirming what changed and (if relevant) suggest a next step.
- For analysis tools: the card renders automatically. Reply in 1-2 sentences highlighting the most important takeaway. Do NOT restate the full JSON.

Style: warm, plain language, no jargon, no markdown headers in chat replies.`;

/**
 * Mastra Memory = CONVERSATION persistence only (message history per thread).
 * Financial data is NOT stored here — MongoDB/Mongoose is the source of truth for that.
 * Storage is inherited from the Mastra instance (MongoDBStore, see mastra.ts).
 */
export const coachMemory = new Memory({
  options: {
    lastMessages: env.MEMORY_LAST_MESSAGES,
    semanticRecall: false,
    generateTitle: false,
  },
});

export const coachAgent = new Agent({
  id: 'finance-coach-agent',
  name: 'FinanceCoachAgent',
  description: 'Routes user requests to profile updates or specialist analysis agents.',
  // ADK `before_agent_callback=on_before_agent` ("initialize financial_data if missing"):
  // the instructions resolver runs once per invocation with the RequestContext, so the
  // user's profile document is created on first contact. The prompt text itself is unchanged.
  instructions: async ({ requestContext }) => {
    const userId = tryGetUserId(requestContext);
    if (userId) await ensureFinancialProfile(userId);
    return COACH_INSTRUCTION;
  },
  model,
  tools: {
    set_monthly_income: setMonthlyIncomeTool,
    set_dependants: setDependantsTool,
    set_expenses: setExpensesTool,
    add_debts: addDebtsTool,
    remove_debts: removeDebtsTool,
    BudgetAnalysisAgent: runBudgetAnalysisTool,
    SavingsStrategyAgent: runSavingsStrategyTool,
    DebtReductionAgent: runDebtReductionTool,
    FullAnalysisPipeline: runFullAnalysisTool,
    get_saved_report: getSavedReportTool,
  },
  memory: coachMemory,
  defaultOptions: { providerOptions: coachProviderOptions },
});
