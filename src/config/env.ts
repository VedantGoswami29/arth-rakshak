import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const boolFromString = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(8000),
    // Same-origin by default (Express serves the SPA). Set only if a different origin calls the API.
    CORS_ORIGIN: z.string().optional(),
    // Number of reverse-proxy hops to trust for req.ip (rate limiting). Unset = don't trust proxies.
    TRUST_PROXY: z.coerce.number().int().min(0).optional(),
    // Where the built Vite app lives. Default: <cwd>/frontend/dist
    FRONTEND_DIST_DIR: z.string().optional(),

    GROQ_API_KEY: z.string().min(1, 'GROQ_API_KEY is required'),
    GROQ_MODEL: z.string().min(1).default('openai/gpt-oss-120b'),
    // Reasoning tokens are billed. Default: 'low' for gpt-oss models, unset (not sent) otherwise.
    // Separate knobs: the coach only routes/chats (cheap), the specialists do the math (needs more).
    GROQ_REASONING_EFFORT_COACH: z.enum(['low', 'medium', 'high']).optional(),
    GROQ_REASONING_EFFORT_SPECIALISTS: z.enum(['low', 'medium', 'high']).optional(),
    GROQ_STRUCTURED_OUTPUT: z.enum(['native', 'prompt']).default('native'),

    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    MONGODB_DB_NAME: z.string().min(1).default('finance_coach'),
    MONGODB_MAX_POOL_SIZE: z.coerce.number().int().positive().default(10),
    MONGOOSE_AUTO_INDEX: boolFromString.default(true),

    AUTH_JWT_SECRET: z.string().min(32, 'AUTH_JWT_SECRET must be at least 32 characters'),
    JWT_EXPIRES_IN: z.string().default('7d'),
    BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
    AUTH_JWT_ISSUER: z.string().optional(),
    AUTH_JWT_AUDIENCE: z.string().optional(),
    ALLOW_INSECURE_DEV_AUTH: boolFromString.default(false),

    MEMORY_LAST_MESSAGES: z.coerce.number().int().min(1).max(200).default(8),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV === 'production' && cfg.ALLOW_INSECURE_DEV_AUTH) {
      ctx.addIssue({
        code: 'custom',
        path: ['ALLOW_INSECURE_DEV_AUTH'],
        message: 'ALLOW_INSECURE_DEV_AUTH must be false in production',
      });
    }
  });

function loadEnv() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}

export const env = loadEnv();
export type Env = typeof env;
