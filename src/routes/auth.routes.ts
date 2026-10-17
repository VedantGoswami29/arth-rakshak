import { Router } from 'express';
import { env } from '../config/env.js';
import { signAccessToken } from '../context/auth.js';
import { allow } from '../context/rateLimit.js';
import { LoginSchema, RegisterSchema } from '../schemas/auth.schema.js';
import { registerUser, verifyCredentials } from '../services/user.service.js';

export const authRoutes = Router();

const WINDOW = 15 * 60_000;

async function tokenResponse(user: { id: string; email: string; name?: string }, tokenVersion: number) {
  return { user, token: await signAccessToken(user.id, tokenVersion), expiresIn: env.JWT_EXPIRES_IN };
}

authRoutes.post('/register', async (req, res) => {
  if (!allow(`register:${req.ip}`, 10, WINDOW)) {
    res.status(429).json({ error: 'Too many attempts' });
    return;
  }
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
    return;
  }
  const { user, tokenVersion } = await registerUser(parsed.data); // EMAIL_TAKEN → 409
  res.status(201).json(await tokenResponse(user, tokenVersion));
});

authRoutes.post('/login', async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
    return;
  }
  // Throttle per IP and per target account so one account can't be brute-forced cheaply from many IPs.
  if (!allow(`login-ip:${req.ip}`, 30, WINDOW) || !allow(`login-email:${parsed.data.email}`, 10, WINDOW)) {
    res.status(429).json({ error: 'Too many attempts. Try again later.' });
    return;
  }
  const { user, tokenVersion } = await verifyCredentials(parsed.data.email, parsed.data.password);
  res.json(await tokenResponse(user, tokenVersion));
});
