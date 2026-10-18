import { createGroq } from '@ai-sdk/groq';
import type { ZodType } from 'zod';
import { env } from './env.js';

/** Groq provider (reads the key explicitly from validated GROQ_API_KEY). */
export const groq = createGroq({ apiKey: env.GROQ_API_KEY });

/** Single place that decides which Groq model every agent uses (was "gemini-3.5-flash"). */
export const model = groq(env.GROQ_MODEL);

/**
 * Structured-output options shared by all specialist agents (the equivalent of
 * ADK's `output_schema`). "native" uses Groq's json_schema response format;
 * "prompt" injects the schema into the prompt for models without json_schema.
 */
export function structuredOutputOptions<T extends ZodType>(schema: T, opts: { forcePrompt?: boolean } = {}) {
  return {
    schema,
    // `forcePrompt` is used on retries: if Groq's native json_schema mode produced an empty
    // completion, asking for JSON through the prompt takes a different code path.
    jsonPromptInjection: opts.forcePrompt === true || env.GROQ_STRUCTURED_OUTPUT === 'prompt',
    errorStrategy: 'strict' as const,
  };
}

/**
 * Groq `reasoningEffort` provider option (gpt-oss et al. bill reasoning tokens as output).
 * Only sent for models that support it, otherwise Groq answers 400.
 */
const supportsReasoning = env.GROQ_MODEL.includes('gpt-oss');
const providerOptionsFor = (effort: 'low' | 'medium' | 'high' | undefined) =>
  effort ? { groq: { reasoningEffort: effort } } : undefined;

/** Coach: routing + short replies → low effort by default. */
export const coachProviderOptions = providerOptionsFor(
  env.GROQ_REASONING_EFFORT_COACH ?? (supportsReasoning ? 'low' : undefined),
);

/**
 * Specialists default to LOW effort too: three sequential calls per full review must fit small
 * tokens-per-minute budgets. If you have headroom and want better payoff-plan math, set
 * GROQ_REASONING_EFFORT_SPECIALISTS=medium.
 */
export const specialistProviderOptions = providerOptionsFor(
  env.GROQ_REASONING_EFFORT_SPECIALISTS ?? (supportsReasoning ? 'low' : undefined),
);
