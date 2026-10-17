import { z } from 'zod';

// bcrypt only hashes the first 72 BYTES, so longer passwords are rejected rather than silently truncated.
const Password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .refine((p) => new TextEncoder().encode(p).length <= 72, 'Password must be at most 72 bytes');

const Email = z.string().trim().toLowerCase().email().max(254);

export const RegisterSchema = z.object({
  email: Email,
  password: Password,
  name: z.string().trim().min(1).max(100).optional(),
});

export const LoginSchema = z.object({
  email: Email,
  // No length rules on login: never leak the policy or reject legacy passwords.
  password: z.string().min(1).max(1024),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: Password,
});

export const DeleteAccountSchema = z.object({
  password: z.string().min(1).max(1024),
});
