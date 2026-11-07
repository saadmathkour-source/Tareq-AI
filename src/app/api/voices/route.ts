import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1).max(120),
  language: z.string().min(2).max(10).default('en'),
  provider: z.string().min(1).default('openai'),
  providerVoiceId: z.string().optional(),
  sampleUrl: z.string().url().optional(),
});

export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get('userId');
  const voices = await prisma.voiceProfile.findMany({
    where: userId ? { userId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return NextResponse.json({ voices });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const voice = await prisma.voiceProfile.create({ data: parsed.data });
    return NextResponse.json({ voice }, { status: 201 });
  } catch (error) {
    // P2003: the referenced user does not exist yet (mirrored from Supabase Auth).
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2003'
    ) {
      return NextResponse.json(
        { error: `No user with id "${parsed.data.userId}". Sync the user from Supabase Auth first.` },
        { status: 409 },
      );
    }
    throw error;
  }
}
