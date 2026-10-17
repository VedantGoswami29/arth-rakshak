import { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';

/**
 * The authenticated userId travels ONLY through Mastra's RequestContext:
 * set by the HTTP layer after authentication, read by tools / instruction
 * resolvers. It is never part of any tool input schema or prompt, so the LLM
 * cannot choose or spoof it.
 */
export const USER_ID_KEY = 'userId';

export type FinanceRequestValues = { userId: string };

export const UserIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:@|-]+$/, 'userId contains invalid characters');

export function createRequestContext(userId: string): RequestContext<FinanceRequestValues> {
  const rc = new RequestContext<FinanceRequestValues>();
  rc.set(USER_ID_KEY, UserIdSchema.parse(userId));
  return rc;
}

/** Strict: throws if no valid authenticated user is present (used by tools). */
export function requireUserId(rc: RequestContext<any> | undefined): string {
  const raw: unknown = rc?.get(USER_ID_KEY);
  const parsed = UserIdSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error('Unauthenticated: no userId in request context');
  }
  return parsed.data;
}

/** Lenient: returns undefined if absent (used by instruction resolvers, e.g. Studio previews). */
export function tryGetUserId(rc: RequestContext<any> | undefined): string | undefined {
  const parsed = UserIdSchema.safeParse(rc?.get(USER_ID_KEY));
  return parsed.success ? parsed.data : undefined;
}
