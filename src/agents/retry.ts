/**
 * Retry helper for transient LLM-provider failures.
 *
 * Groq enforces a tokens-per-minute cap (e.g. 8,000 on some tiers). A full review makes several
 * model calls and can exceed it; the provider then answers 429 — or, when the budget runs out
 * mid-request, a 400 `json_validate_failed` with an EMPTY `failed_generation`. Both are fixed by
 * waiting for the token window to reset and trying again. The wait is read from the response
 * headers (`retry-after` / `x-ratelimit-reset-tokens`) instead of guessing.
 */

type ErrLike = {
  message?: string;
  statusCode?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  cause?: unknown;
  lastError?: unknown;
  errors?: unknown[];
};

/** The error plus everything it wraps (AI SDK / Mastra wrap provider errors in several layers). */
function chain(err: unknown): ErrLike[] {
  const out: ErrLike[] = [];
  const seen = new Set<unknown>();
  const visit = (e: unknown, depth: number) => {
    if (!e || typeof e !== 'object' || seen.has(e) || depth > 4) return;
    seen.add(e);
    const x = e as ErrLike;
    out.push(x);
    visit(x.cause, depth + 1);
    visit(x.lastError, depth + 1);
    (x.errors ?? []).forEach((i) => visit(i, depth + 1));
  };
  visit(err, 0);
  return out;
}

const statusOf = (err: unknown): number | undefined => chain(err).find((e) => typeof e.statusCode === 'number')?.statusCode;

function headersOf(err: unknown): Record<string, string> {
  const raw = chain(err).find((e) => e.responseHeaders)?.responseHeaders ?? {};
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), String(v)]));
}

const textOf = (err: unknown): string =>
  chain(err)
    .map((e) => `${e.message ?? ''} ${typeof e.responseBody === 'string' ? e.responseBody : ''}`)
    .join(' ')
    .toLowerCase();

const TRANSIENT_TEXT =
  /rate limit|json_validate_failed|failed to validate json|tool call validation failed|attempted to call tool|did not return structured output|structured output validation failed|structured output was truncated|overloaded|temporarily|timed? ?out/;

export function isTransientLlmError(err: unknown): boolean {
  const status = statusOf(err);
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  return TRANSIENT_TEXT.test(textOf(err));
}

/** "48.3s", "1m2.5s", "350ms" → milliseconds. */
export function parseDuration(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as const;
  let ms = 0;
  let found = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
    found = true;
    ms += parseFloat(m[1] ?? '0') * unit[m[2] as keyof typeof unit];
  }
  return found ? ms : undefined;
}

export function retryDelayMs(err: unknown, attempt: number, maxWaitMs: number): number {
  const h = headersOf(err);
  const retryAfter = h['retry-after'] !== undefined ? Number(h['retry-after']) * 1000 : NaN;
  const remaining = Number(h['x-ratelimit-remaining-tokens']);
  const resetTokens = parseDuration(h['x-ratelimit-reset-tokens']);

  let ms: number;
  if (Number.isFinite(retryAfter)) ms = retryAfter;
  else if (resetTokens !== undefined && (statusOf(err) === 429 || remaining < 3000)) ms = resetTokens; // token window (nearly) empty → wait for it
  else ms = 1500 * 2 ** attempt;
  return Math.min(maxWaitMs, Math.max(1000, ms + 500));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const brief = (err: unknown) => {
  const s = statusOf(err);
  const m = (chain(err)[0]?.message ?? 'error').replace(/\s+/g, ' ').slice(0, 70);
  return s ? `${s}: ${m}` : m;
};

export async function withLlmRetry<T>(
  /** Receives the attempt number (0 = first try) so callers can change strategy when retrying. */
  fn: (attempt: number) => Promise<T>,
  opts: { label: string; retries?: number; maxWaitMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  const retries = opts.retries ?? 2;
  const maxWait = opts.maxWaitMs ?? 65_000;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !isTransientLlmError(err)) throw err;
      const wait = retryDelayMs(err, attempt, maxWait);
      console.warn(`[llm-retry] ${opts.label}: ${brief(err)} — retry ${attempt + 1}/${retries} in ${(wait / 1000).toFixed(1)}s`);
      await (opts.sleep ?? sleep)(wait);
    }
  }
}
