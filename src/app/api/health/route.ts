import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liveness + dependency probe. Never returns secret values, only presence flags. */
export async function GET() {
  const startedAt = Date.now();
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  checks.env = {
    ok: Boolean(process.env.DATABASE_URL && process.env.SUPABASE_URL),
    detail: [
      process.env.OPENAI_API_KEY ? 'openai' : null,
      process.env.DEEPSEEK_API_KEY ? 'deepseek' : null,
      process.env.STRIPE_SECRET_KEY ? 'stripe' : null,
    ]
      .filter(Boolean)
      .join('+'),
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { ok: true };
  } catch (error) {
    checks.database = {
      ok: false,
      detail: error instanceof Error ? error.message : 'unknown error',
    };
  }

  const ok = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    {
      ok,
      service: 'voiceproxy-ai',
      version: '0.1.0',
      uptimeMs: Date.now() - startedAt,
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
