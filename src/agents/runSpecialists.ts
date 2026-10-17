import type { Agent } from '@mastra/core/agent';
import type { RequestContext } from '@mastra/core/request-context';
import { specialistProviderOptions, structuredOutputOptions } from '../config/llm.js';
import { requireUserId } from '../context/requestContext.js';
import {
  REPORT_SCHEMAS,
  type ReportDataMap,
  type ReportType,
} from '../schemas/finance.schema.js';
import { saveReport } from '../services/finance.service.js';
import { budgetAgent } from './budgetAgent.js';
import { debtAgent } from './debtAgent.js';
import { savingsAgent } from './savingsAgent.js';

/**
 * Runs one specialist agent with structured output and stores the result
 * (ADK `output_key` → state write; here → MongoDB `financial_reports`).
 * Shared by the coach's agent-tools and the workflow steps so both paths behave identically.
 */
async function runSpecialist<T extends ReportType>(opts: {
  agent: Agent;
  reportType: T;
  request: string | null | undefined;
  requestContext: RequestContext<any>;
  runId?: string;
}): Promise<ReportDataMap[T]> {
  const { agent, reportType, requestContext, runId } = opts;
  const userId = requireUserId(requestContext);
  const schema = REPORT_SCHEMAS[reportType];

  const prompt = opts.request?.trim() || `Run the ${agent.name} analysis for the user.`;
  const result = await agent.generate(prompt, {
    structuredOutput: structuredOutputOptions(schema),
    providerOptions: specialistProviderOptions,
    requestContext,
  });

  if (result.object == null) {
    throw new Error(`${agent.name} did not return structured output`);
  }
  const validated = schema.parse(result.object) as ReportDataMap[T];
  return saveReport(userId, reportType, validated, runId);
}

type RunArgs = { requestContext: RequestContext<any>; request?: string | null; runId?: string };

export const runBudgetAnalysis = (a: RunArgs) =>
  runSpecialist({ agent: budgetAgent, reportType: 'budget_analysis', request: a.request, requestContext: a.requestContext, runId: a.runId });

export const runSavingsStrategy = (a: RunArgs) =>
  runSpecialist({ agent: savingsAgent, reportType: 'savings_strategy', request: a.request, requestContext: a.requestContext, runId: a.runId });

export const runDebtReduction = (a: RunArgs) =>
  runSpecialist({ agent: debtAgent, reportType: 'debt_reduction', request: a.request, requestContext: a.requestContext, runId: a.runId });
