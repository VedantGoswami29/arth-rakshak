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
import { applyComputedPlans, buildFallbackDebtReport } from '../domain/payoff.js';
import { getFinancialData } from '../services/finance.service.js';
import { isTransientLlmError, withLlmRetry } from './retry.js';
import { budgetAgent } from './budgetAgent.js';
import { debtAgent } from './debtAgent.js';
import { savingsAgent } from './savingsAgent.js';

/**
 * Runs one specialist agent with structured output and stores the result
 * (ADK `output_key` → state write; here → MongoDB `financial_reports`).
 * Shared by the coach's agent-tools and the workflow steps so both paths behave identically.
 */
export async function runSpecialist<T extends ReportType>(opts: {
  agent: Agent;
  reportType: T;
  request: string | null | undefined;
  requestContext: RequestContext<any>;
  runId?: string;
  /** Deterministic post-processing of the model's output (e.g. overwrite numbers with computed ones). */
  finalize?: (report: ReportDataMap[T], userId: string) => Promise<ReportDataMap[T]>;
  /** Used when the model keeps failing: build a valid report without it. */
  fallback?: (userId: string) => Promise<ReportDataMap[T]>;
}): Promise<ReportDataMap[T]> {
  const { agent, reportType, requestContext, runId } = opts;
  const userId = requireUserId(requestContext);
  const schema = REPORT_SCHEMAS[reportType];

  const prompt = opts.request?.trim() || `Run the ${agent.name} analysis for the user.`;
  // Transient provider failures (token-per-minute cap, empty/invalid JSON) are retried after the
  // provider's own suggested wait — see retry.ts.
  let validated: ReportDataMap[T];
  try {
    validated = await withLlmRetry(
    async (attempt) => {
      const result = await agent.generate(prompt, {
        // First try: Groq's native JSON-schema mode. Retries: schema injected into the prompt instead.
        structuredOutput: structuredOutputOptions(schema, { forcePrompt: attempt > 0 }),
        providerOptions: specialistProviderOptions,
        requestContext,
      });
      if (result.object == null) {
        // The call succeeded but the model returned nothing usable (typically an empty,
        // reasoning-only completion). Say so precisely — this ends up in the server log.
        const out = (result as { usage?: { outputTokens?: number; completionTokens?: number } }).usage;
        throw new Error(
          `${agent.name} did not return structured output: empty completion ` +
            `(finish=${String(result.finishReason)}, text length=${result.text?.length ?? 0}, ` +
            `output tokens=${out?.outputTokens ?? out?.completionTokens ?? '?'})`,
        );
      }
      return schema.parse(result.object) as ReportDataMap[T];
    },
    { label: agent.name },
  );
    if (opts.finalize) validated = await opts.finalize(validated, userId);
  } catch (err) {
    if (!opts.fallback || !isTransientLlmError(err)) throw err;
    console.warn(`[specialist] ${agent.name} failed after retries — using the computed fallback report`);
    validated = await opts.fallback(userId);
  }
  return saveReport(userId, reportType, validated, runId);
}

type RunArgs = { requestContext: RequestContext<any>; request?: string | null; runId?: string };

export const runBudgetAnalysis = (a: RunArgs) =>
  runSpecialist({ agent: budgetAgent, reportType: 'budget_analysis', request: a.request, requestContext: a.requestContext, runId: a.runId });

export const runSavingsStrategy = (a: RunArgs) =>
  runSpecialist({ agent: savingsAgent, reportType: 'savings_strategy', request: a.request, requestContext: a.requestContext, runId: a.runId });

export const runDebtReduction = (a: RunArgs) =>
  runSpecialist({
    agent: debtAgent,
    reportType: 'debt_reduction',
    request: a.request,
    requestContext: a.requestContext,
    runId: a.runId,
    // The model writes the advice; the numbers come from code (exact, and no reasoning-token cost).
    finalize: async (report, userId) => applyComputedPlans(report, await getFinancialData(userId)),
    fallback: async (userId) => buildFallbackDebtReport(await getFinancialData(userId)),
  });
