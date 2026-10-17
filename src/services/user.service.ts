import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { UserModel } from '../models/User.js';

/**
 * User persistence + credential handling. The user's `_id` (hex string) IS the
 * `userId` used everywhere else (JWT `sub`, RequestContext, all finance queries).
 */

export type UserErrorCode =
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'VALIDATION'
  | 'DB_UNAVAILABLE'
  | 'UNKNOWN';

export class UserServiceError extends Error {
  constructor(
    public readonly code: UserErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'UserServiceError';
  }
}

export interface PublicUser {
  id: string;
  email: string;
  name?: string;
  createdAt: Date;
}

// A real bcrypt hash of a random string: compared against when the email is unknown,
// so "no such user" and "wrong password" take the same time (no user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('timing-equalisation-dummy', env.BCRYPT_ROUNDS);

function mapError(op: string, err: unknown): UserServiceError {
  if (err instanceof UserServiceError) return err;
  if (err instanceof mongoose.Error.ValidationError || err instanceof mongoose.Error.CastError) {
    return new UserServiceError('VALIDATION', `${op}: ${err.message}`, err);
  }
  if ((err as { code?: number } | null)?.code === 11000) {
    return new UserServiceError('EMAIL_TAKEN', 'Email already registered', err);
  }
  const name = (err as { name?: string } | null)?.name ?? '';
  if (/MongoNetwork|MongoServerSelection|MongooseServerSelection|MongoTimeout|MongoNotConnected/.test(name)) {
    return new UserServiceError('DB_UNAVAILABLE', `${op}: database unavailable`, err);
  }
  return new UserServiceError('UNKNOWN', `${op}: unexpected database error`, err);
}

async function run<T>(op: string, fn: () => Promise<T>): Promise<T> {
  try {
    await connectDB();
    return await fn();
  } catch (err) {
    const e = mapError(op, err);
    if (e.code === 'DB_UNAVAILABLE' || e.code === 'UNKNOWN') {
      console.error(`[user.service] ${e.code}: ${e.message}` + (e.cause instanceof Error ? ` (${e.cause.name})` : ''));
    }
    throw e;
  }
}

const toPublic = (u: { _id: unknown; email: string; name?: string | null; createdAt: Date }): PublicUser => ({
  id: String(u._id),
  email: u.email,
  ...(u.name ? { name: u.name } : {}),
  createdAt: u.createdAt,
});

export function registerUser(input: { email: string; password: string; name?: string }) {
  return run('registerUser', async () => {
    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
    // Unique index on email makes this race-safe; E11000 → EMAIL_TAKEN.
    const user = await UserModel.create({ email: input.email, passwordHash, name: input.name });
    return { user: toPublic(user), tokenVersion: user.tokenVersion };
  });
}

export function verifyCredentials(email: string, password: string) {
  return run('verifyCredentials', async () => {
    const user = await UserModel.findOne({ email }).select('+passwordHash');
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new UserServiceError('INVALID_CREDENTIALS', 'Invalid email or password');
    if (user.status !== 'active') throw new UserServiceError('ACCOUNT_DISABLED', 'Account is disabled');

    user.lastLoginAt = new Date();
    await user.save();
    return { user: toPublic(user), tokenVersion: user.tokenVersion };
  });
}

/** Per-request token check: user must exist, be active, and match the token's version. */
export function isTokenValidForUser(userId: string, tokenVersion: number): Promise<boolean> {
  return run('isTokenValidForUser', async () => {
    if (!mongoose.isValidObjectId(userId)) return false;
    const u = await UserModel.findById(userId).select({ status: 1, tokenVersion: 1 }).lean();
    return !!u && u.status === 'active' && u.tokenVersion === tokenVersion;
  });
}

export function getUserById(userId: string): Promise<PublicUser | null> {
  return run('getUserById', async () => {
    if (!mongoose.isValidObjectId(userId)) return null;
    const u = await UserModel.findById(userId).lean();
    return u ? toPublic(u) : null;
  });
}

async function checkPassword(userId: string, password: string) {
  const user = await UserModel.findById(userId).select('+passwordHash');
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new UserServiceError('INVALID_CREDENTIALS', 'Invalid password');
  return user;
}

/** Changes the password and invalidates every existing token (returns the new tokenVersion). */
export function changePassword(userId: string, currentPassword: string, newPassword: string) {
  return run('changePassword', async () => {
    const user = await checkPassword(userId, currentPassword);
    user.passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
    user.tokenVersion += 1;
    await user.save();
    return { tokenVersion: user.tokenVersion };
  });
}

/** "Log out everywhere": invalidates all issued tokens. */
export function revokeAllTokens(userId: string): Promise<void> {
  return run('revokeAllTokens', async () => {
    await UserModel.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  });
}

export function verifyPasswordForUser(userId: string, password: string): Promise<void> {
  return run('verifyPasswordForUser', async () => {
    await checkPassword(userId, password);
  });
}

export function deleteUserRecord(userId: string): Promise<boolean> {
  return run('deleteUserRecord', async () => {
    const r = await UserModel.deleteOne({ _id: userId });
    return r.deletedCount === 1;
  });
}

export async function initUserModel(): Promise<void> {
  await connectDB();
  await UserModel.init();
}
