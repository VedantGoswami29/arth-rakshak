import { jwtVerify, SignJWT } from 'jose';
import { env } from '../config/env.js';
import { isTokenValidForUser } from '../services/user.service.js';
import { UserIdSchema } from './requestContext.js';

const secretKey = new TextEncoder().encode(env.AUTH_JWT_SECRET);

export class AuthError extends Error {}

/** Issue an HS256 access token: sub = user id, ver = user's tokenVersion (revocation). */
export async function signAccessToken(userId: string, tokenVersion: number): Promise<string> {
  const jwt = new SignJWT({ ver: tokenVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(env.JWT_EXPIRES_IN);
  if (env.AUTH_JWT_ISSUER) jwt.setIssuer(env.AUTH_JWT_ISSUER);
  if (env.AUTH_JWT_AUDIENCE) jwt.setAudience(env.AUTH_JWT_AUDIENCE);
  return jwt.sign(secretKey);
}

/**
 * Resolve the authenticated userId from request headers — the ONLY place a userId is established.
 *  - `Authorization: Bearer <JWT>` issued by /auth/login or /auth/register. The token is
 *    verified, then the user is re-checked in MongoDB (exists, active, tokenVersion matches),
 *    so disabling a user or changing a password takes effect immediately.
 *  - Local dev only (ALLOW_INSECURE_DEV_AUTH=true, never in production): `x-user-id` header.
 */
export async function authenticate(headers: Headers): Promise<string> {
  const authz = headers.get('authorization');

  if (authz?.toLowerCase().startsWith('bearer ')) {
    const token = authz.slice(7).trim();
    let sub: string;
    let ver: number;
    try {
      const { payload } = await jwtVerify(token, secretKey, {
        algorithms: ['HS256'],
        issuer: env.AUTH_JWT_ISSUER,
        audience: env.AUTH_JWT_AUDIENCE,
      });
      const parsed = UserIdSchema.safeParse(payload.sub);
      if (!parsed.success || typeof payload.ver !== 'number') throw new Error('bad claims');
      sub = parsed.data;
      ver = payload.ver;
    } catch {
      throw new AuthError('Invalid or expired token');
    }
    if (!(await isTokenValidForUser(sub, ver))) throw new AuthError('Invalid or expired token');
    return sub;
  }

  if (env.ALLOW_INSECURE_DEV_AUTH && env.NODE_ENV !== 'production') {
    const parsed = UserIdSchema.safeParse(headers.get('x-user-id'));
    if (parsed.success) return parsed.data;
  }

  throw new AuthError('Authentication required');
}
