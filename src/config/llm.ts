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
export function structuredOutputOptions<T extends ZodType>(schema: T) {
  return {
    schema,
    jsonPromptInjection: env.GROQ_STRUCTURED_OUTPUT === 'prompt',
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

/** Specialists: payoff-plan math and structured reports → medium effort by default. */
export const specialistProviderOptions = providerOptionsFor(
  env.GROQ_REASONING_EFFORT_SPECIALISTS ?? (supportsReasoning ? 'medium' : undefined),
);
