import type { RequestContext } from '@mastra/core/request-context';
import { tryGetUserId } from '../context/requestContext.js';
import { createDefaultFinancialData } from '../domain/financial.js';
import type { ReportType } from '../schemas/finance.schema.js';
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

/** Render selected state slices as a readable context block (`_state_context`). */
async function stateContext(userId: string | undefined, includeKeys: ReportType[]): Promise<string> {
  const fd = userId ? await getFinancialData(userId) : createDefaultFinancialData();
  const blocks: string[] = [`FINANCIAL DATA:\n${safeDumps(fd)}`];

  if (userId) {
    const reports = await Promise.all(includeKeys.map(async (k) => [k, await getLatestReport(userId, k)] as const));
    for (const [key, value] of reports) {
      if (value) blocks.push(`${key.toUpperCase()}:\n${safeDumps(value)}`);
    }
  }
  return blocks.join('\n\n');
}

export function makeStateInjector(baseInstructions: string, priorKeys: ReportType[]) {
  return async ({ requestContext }: { requestContext: RequestContext<any> }): Promise<string> => {
    const context = await stateContext(tryGetUserId(requestContext), priorKeys);
    const prefix =
      "The user's financial information and prior agent outputs are below. " +
      'Use them to produce your structured response.\n\n' +
      `${context}\n\n---\n`;
    return prefix + baseInstructions;
  };
}
