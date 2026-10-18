import type { RequestContext } from '@mastra/core/request-context';
import { tryGetUserId } from '../context/requestContext.js';
import { createDefaultFinancialData } from '../domain/financial.js';
import type { BudgetAnalysis, FinancialData, ReportType, SavingsStrategy } from '../schemas/finance.schema.js';
import { getFinancialData, getLatestReport } from '../services/finance.service.js';

/**
 * ADK `before_model_callback` (`_make_state_injector`) equivalent.
 *
 * ADK mutated `llm_request.config.system_instruction` right before each model
 * call. In Mastra, `instructions` can be an async function resolved per run
 * with the RequestContext — so the same prefix is built from MongoDB (source of
 * truth) instead of in-memory session state, then prepended to the agent's
 * static instructions. The userId comes from the RequestContext, never the LLM.
 */

function safeDumps(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Prior reports are injected for the NEXT agent in the pipeline. They only need the numbers and
 * categories, not the prose (recommendation text, rationales, automation tips), so those are
 * dropped to save tokens. FINANCIAL DATA is never trimmed.
 */
function compactForPrompt(key: ReportType, value: unknown): unknown {
  if (key === 'budget_analysis') {
    const b = value as BudgetAnalysis;
    return {
      total_expenses: b.total_expenses,
      monthly_income: b.monthly_income,
      spending_categories: b.spending_categories.map((c) => ({ category: c.category, amount: c.amount })),
      recommendations: b.recommendations.map((r) => ({ category: r.category, potential_savings: r.potential_savings })),
    };
  }
  if (key === 'savings_strategy') {
    const s = value as SavingsStrategy;
    return {
      emergency_fund: s.emergency_fund,
      recommendations: s.recommendations.map((r) => ({ category: r.category, amount: r.amount })),
    };
  }
  return value;
}

/** Render selected state slices as a readable context block (`_state_context`). */
async function stateContext(
  userId: string | undefined,
  includeKeys: ReportType[],
  extraBlock?: (fd: FinancialData) => string | null,
): Promise<string> {
  const fd = userId ? await getFinancialData(userId) : createDefaultFinancialData();
  const blocks: string[] = [`FINANCIAL DATA:\n${safeDumps(fd)}`];
  const extra = extraBlock?.(fd);
  if (extra) blocks.push(extra);

  if (userId) {
    const reports = await Promise.all(includeKeys.map(async (k) => [k, await getLatestReport(userId, k)] as const));
    for (const [key, value] of reports) {
      if (value) blocks.push(`${key.toUpperCase()}:\n${safeDumps(compactForPrompt(key, value))}`);
    }
  }
  return blocks.join('\n\n');
}

export function makeStateInjector(
  baseInstructions: string,
  priorKeys: ReportType[],
  extraBlock?: (fd: FinancialData) => string | null,
) {
  return async ({ requestContext }: { requestContext: RequestContext<any> }): Promise<string> => {
    const context = await stateContext(tryGetUserId(requestContext), priorKeys, extraBlock);
    const prefix =
      "The user's financial information and prior agent outputs are below. " +
      'Use them to produce your structured response.\n\n' +
      `${context}\n\n---\n`;
    return prefix + baseInstructions;
  };
}
