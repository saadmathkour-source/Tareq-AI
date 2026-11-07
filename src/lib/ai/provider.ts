import OpenAI from 'openai';
import { serverEnv } from '@/lib/env';

export type AiProvider = 'openai' | 'deepseek';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

const models: Record<AiProvider, string> = {
  openai: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  deepseek: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
};

const cache = new Map<AiProvider, OpenAI>();

/** Returns an OpenAI-compatible client for the requested provider. */
export function aiClient(provider: AiProvider = (serverEnv().AI_PROVIDER as AiProvider)) {
  const cached = cache.get(provider);
  if (cached) return cached;

  const env = serverEnv();
  const client =
    provider === 'deepseek'
      ? new OpenAI({
          apiKey: env.DEEPSEEK_API_KEY ?? env.OPENAI_API_KEY,
          baseURL: DEEPSEEK_BASE_URL,
        })
      : new OpenAI({ apiKey: env.OPENAI_API_KEY });

  cache.set(provider, client);
  return client;
}

export function aiModel(provider: AiProvider = (serverEnv().AI_PROVIDER as AiProvider)) {
  return models[provider];
}
