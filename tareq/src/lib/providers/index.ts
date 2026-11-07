import OpenAI from 'openai';
import { ProviderError } from '../core/errors.ts';
import { env, hasSecret } from '../env.ts';

/**
 * Provider abstraction. One interface, several backends, so the rest of the
 * system never hard-codes a vendor. DeepSeek speaks the OpenAI wire protocol,
 * so a single SDK serves both with different base URLs.
 */

export type ProviderName = 'openai' | 'deepseek';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Forces JSON output where the provider supports it. */
  json?: boolean;
}

export interface ChatResult {
  provider: ProviderName;
  model: string;
  content: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

/** USD per 1M tokens, keyed by model prefix. Update as vendors change prices. */
const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1': { input: 2, output: 8 },
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
};

export function priceOf(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(PRICING).find((k) => model.startsWith(k));
  const p = key ? PRICING[key]! : { input: 1, output: 3 };
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

/** Cheap default models per provider, chosen to keep routine work inexpensive. */
export const DEFAULT_MODEL: Record<ProviderName, string> = {
  openai: 'gpt-4o-mini',
  deepseek: 'deepseek-chat',
};

function clientFor(provider: ProviderName): OpenAI {
  if (provider === 'openai') {
    if (!hasSecret('OPENAI_API_KEY')) throw new ProviderError('openai', 'OPENAI_API_KEY not configured', false);
    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY!, timeout: 60_000, maxRetries: 0 });
  }
  if (!hasSecret('DEEPSEEK_API_KEY')) throw new ProviderError('deepseek', 'DEEPSEEK_API_KEY not configured', false);
  return new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY!,
    baseURL: 'https://api.deepseek.com/v1',
    timeout: 60_000,
    maxRetries: 0,
  });
}

export function isConfigured(provider: ProviderName): boolean {
  return provider === 'openai' ? hasSecret('OPENAI_API_KEY') : hasSecret('DEEPSEEK_API_KEY');
}

export async function chat(provider: ProviderName, req: ChatRequest): Promise<ChatResult> {
  const model = req.model ?? DEFAULT_MODEL[provider];
  const started = Date.now();
  try {
    const client = clientFor(provider);
    const completion = await client.chat.completions.create({
      model,
      messages: req.messages,
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxTokens,
      ...(req.json ? { response_format: { type: 'json_object' as const } } : {}),
    });
    const inputTokens = completion.usage?.prompt_tokens ?? 0;
    const outputTokens = completion.usage?.completion_tokens ?? 0;
    return {
      provider,
      model: completion.model ?? model,
      content: completion.choices[0]?.message?.content ?? '',
      inputTokens,
      outputTokens,
      costUsd: priceOf(model, inputTokens, outputTokens),
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const message = (err as Error).message;
    // 4xx other than 429 are not worth retrying; transient/5xx are.
    const status = (err as { status?: number }).status;
    const retryable = !status || status === 429 || status >= 500;
    throw new ProviderError(provider, message, retryable);
  }
}

/**
 * Route a request with automatic fallback. Tries the preferred provider, then
 * the other configured one. Records which provider actually answered.
 */
export async function routeChat(
  preferred: ProviderName | undefined,
  req: ChatRequest,
): Promise<ChatResult> {
  const order: ProviderName[] = [];
  const first = preferred ?? env().TAREQ_DEFAULT_PROVIDER;
  order.push(first);
  for (const p of ['openai', 'deepseek'] as ProviderName[]) if (p !== first) order.push(p);

  let lastErr: unknown;
  for (const provider of order) {
    if (!isConfigured(provider)) continue;
    try {
      return await chat(provider, req);
    } catch (err) {
      lastErr = err;
      if (!(err as ProviderError).retryable) throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new ProviderError(first, 'no provider available', false);
}

/** Lightweight reachability probe used by /health and the dashboard. */
export async function probe(provider: ProviderName): Promise<{ ok: boolean; detail?: string }> {
  if (!isConfigured(provider)) return { ok: false, detail: 'not configured' };
  try {
    const client = clientFor(provider);
    await client.models.list();
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: (err as Error).message.slice(0, 160) };
  }
}
