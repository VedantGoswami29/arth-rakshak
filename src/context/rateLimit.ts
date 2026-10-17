/**
 * Minimal fixed-window, in-memory rate limiter for auth endpoints (brute-force
 * protection). Per-process only — behind multiple instances use a shared store
 * (Redis) or your gateway's rate limiting.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, 60_000).unref();

/** Returns true if the call is allowed, false if the limit is exceeded. */
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= max;
}
