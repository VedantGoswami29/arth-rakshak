import type { NextFunction, Request, Response } from 'express';
import { AuthError, authenticate } from '../context/auth.js';
import { FinanceServiceError } from '../services/finance.service.js';
import { UserServiceError } from '../services/user.service.js';

/** Authenticates the request and stores the userId in `res.locals.userId` (the ONLY place it is set). */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v);
    }
    res.locals.userId = await authenticate(headers);
    next();
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(401).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export const userId = (res: Response): string => res.locals.userId as string;

const FINANCE_STATUS = { INVALID_USER: 400, VALIDATION: 422, NOT_FOUND: 404, CONFLICT: 409, DB_UNAVAILABLE: 503, UNKNOWN: 500 } as const;
const USER_STATUS = {
  EMAIL_TAKEN: 409,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_DISABLED: 403,
  VALIDATION: 422,
  DB_UNAVAILABLE: 503,
  UNKNOWN: 500,
} as const;

/** Central error mapper (Express 5 forwards rejected async handlers here automatically). */
export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(err);

  if (err instanceof UserServiceError) {
    res.status(USER_STATUS[err.code]).json({ error: err.code === 'UNKNOWN' ? 'Internal server error' : err.message });
    return;
  }
  if (err instanceof FinanceServiceError) {
    res.status(FINANCE_STATUS[err.code]).json({ error: err.code === 'UNKNOWN' ? 'Internal server error' : err.message });
    return;
  }
  const type = (err as { type?: string } | null)?.type;
  if (type === 'entity.too.large') {
    res.status(413).json({ error: 'Payload too large' });
    return;
  }
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON' });
    return;
  }
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Internal server error' });
}
