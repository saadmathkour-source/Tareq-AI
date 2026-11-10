import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aiClient, aiModel, type AiProvider } from '@/lib/ai/provider';
import { authenticatedUser } from '@/lib/supabase/auth';

export const runtime = 'nodejs';

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8000),
});

const bodySchema = z.object({
  messages: z.array(messageSchema).min(1).max(30),
  provider: z.enum(['openai', 'deepseek']).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export async function POST(request: Request) {
  const user = await authenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { messages, temperature } = parsed.data;
  const provider: AiProvider = parsed.data.provider ?? 'openai';

  try {
    const completion = await aiClient(provider).chat.completions.create({
      model: aiModel(provider),
      messages,
      temperature: temperature ?? 0.7,
    });

    const choice = completion.choices[0];
    return NextResponse.json({
      provider,
      model: completion.model,
      message: choice?.message ?? null,
      usage: completion.usage ?? null,
    });
  } catch {
    return NextResponse.json({ error: 'AI service unavailable' }, { status: 502 });
  }
}
