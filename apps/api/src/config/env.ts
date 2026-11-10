import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  /** HMAC secret for access tokens. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  /** 32 random bytes, base64. Used for AES-256-GCM encryption of secrets at rest. */
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY must be 32 bytes, base64-encoded'),
  ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  LOCKOUT_MAX_FAILURES: z.coerce.number().int().min(1).default(5),
  LOCKOUT_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
  SEED_ADMIN_USERNAME: z.string().default('admin'),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  CORS_ORIGINS: z.string().default('*'),
  DEMO_MODE: bool.default(false),
  /** Shared secret for service-to-service calls (userbot, bot). */
  SERVICE_TOKEN: z.string().min(16).optional(),
  /** How often the intake debounce buffers are checked (ms). 0 disables the timer (tests call processDue directly). */
  INTAKE_POLL_MS: z.coerce.number().int().min(0).default(5000),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

export const APP_ENV = Symbol('APP_ENV');
