import { z } from 'zod';

/**
 * Environment access. Validation is lazy so importing this module never throws
 * during build/test; call `env()` where a value is actually needed.
 *
 * TAREQ is independent: it never reads VoiceProxy AI's database or servers.
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().min(1).optional(),
  TEST_DATABASE_URL: z.string().min(1).optional(),
  TEST_DIRECT_URL: z.string().min(1).optional(),

  TAREQ_OWNER_EMAIL: z.string().email().optional(),
  TAREQ_OWNER_PASSWORD: z.string().min(1).optional(),
  TAREQ_SESSION_SECRET: z.string().min(16, 'TAREQ_SESSION_SECRET must be >= 16 chars').optional(),

  OPENAI_API_KEY: z.string().min(1).optional(),
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  TAREQ_DEFAULT_PROVIDER: z.enum(['openai', 'deepseek']).default('openai'),

  TAREQ_BUDGET_CAP_USD: z.coerce.number().positive().default(20),
  TAREQ_BUDGET_WARN_USD: z.coerce.number().positive().default(15),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_OWNER_ID: z.string().optional(),

  // Gmail (owner OAuth) — all three required to send.
  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  GMAIL_REFRESH_TOKEN: z.string().optional(),
  GMAIL_SENDER: z.string().email().optional(),

  // Transactional email. `resend` is preferred for customer delivery; the
  // `EMAIL_*` names are canonical and `GMAIL_SENDER` is accepted as a fallback
  // sender so a deployment with only the Gmail names still works.
  EMAIL_PROVIDER: z.enum(['resend', 'gmail']).optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),

  // Public checkout link configuration.
  TAREQ_PUBLIC_URL: z.string().url().optional(),
  TAREQ_DOWNLOAD_TTL_HOURS: z.coerce.number().positive().optional(),
  TAREQ_CHECKOUT_RATE_LIMIT: z.coerce.number().positive().optional(),
  TAREQ_CHECKOUT_RATE_WINDOW_MS: z.coerce.number().positive().optional(),

  // HubSpot private-app token.
  HUBSPOT_PRIVATE_APP_TOKEN: z.string().optional(),

  // Stripe (test or live key).
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** True when the given secret name is present and non-empty. Never returns the value. */
export function hasSecret(name: keyof NodeJS.ProcessEnv | string): boolean {
  const v = process.env[name as string];
  return typeof v === 'string' && v.length > 0;
}

/** Presence map for a set of names — safe to expose in health output. */
export function secretPresence(names: string[]): Record<string, boolean> {
  return Object.fromEntries(names.map((n) => [n, hasSecret(n)]));
}
