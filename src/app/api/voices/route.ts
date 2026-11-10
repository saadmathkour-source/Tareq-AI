import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticatedUser } from '@/lib/supabase/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  // Backward-compatible input only; never trust this to identify the owner.
  userId: z.string().min(1).optional(),
  name: z.string().min(1).max(120),
  language: z.string().min(2).max(10).default('en'),
  provider: z.string().min(1).default('openai'),
  providerVoiceId: z.string().optional(),
  sampleUrl: z.string().url().optional(),
});

export async function GET() {
  const user = await authenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const voices = await prisma.voiceProfile.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return NextResponse.json({ voices });
}

export async function POST(request: Request) {
  const user = await authenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
  if (parsed.data.userId && parsed.data.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const voice = await prisma.voiceProfile.create({
      data: { ...parsed.data, userId: user.id },
    });
    return NextResponse.json({ voice }, { status: 201 });
  } catch (error) {
    // P2003: the authenticated user has not been mirrored into the app table.
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2003'
    ) {
      return NextResponse.json(
        { error: 'User record not synchronized. Please contact support.' },
        { status: 409 },
      );
    }
    throw error;
  }
}
