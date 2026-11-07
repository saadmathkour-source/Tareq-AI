import { z } from 'zod';

/**
 * Server-side environment schema.
 * Validated lazily so a missing secret fails at use-time with a clear message
 * instead of crashing the whole build.
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  OPENAI_API_KEY: z.string().min(1),
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  AI_PROVIDER: z.enum(['openai', 'deepseek']).default('openai'),

  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRO_PRICE_ID: z.string().min(1).optional(),

  TAREQ_OWNER_PASSWORD: z.string().min(1).optional(),
  TAREQ_SESSION_SECRET: z.string().min(1).optional(),
  APP_URL: z.string().url().default('http://localhost:3000'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid server environment:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '',
  supabaseAnonKey:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    '',
  stripePublishableKey:
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
    process.env.STRIPE_PUBLISHABLE_KEY ??
    '',
};
