import { prisma } from '../core/db.ts';
import { logger } from '../core/logger.ts';
import { assertCanSpend, recordSpend } from '../security/budget.ts';
import { assertTaskCostAllowed, assertModelCallAllowed } from '../security/controls.ts';
import { record as recordLedger } from '../finance/ledger.ts';
import { routeChat, type ChatMessage, type ChatResult, type ProviderName, priceOf } from './index.ts';

/**
 * Model Router — the single entry point every capability uses to think.
 *
 * Wraps the raw provider call with the cross-cutting concerns the directive
 * requires: budget pre-check, per-call accounting, and an audit trail of which
 * model answered and at what cost. Nothing calls a provider directly.
 */

export interface ThinkOptions {
  purpose: string;
  system?: string;
  messages: ChatMessage[];
  provider?: ProviderName;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  taskId?: string;
}

/** Conservative per-call ceiling used for the pre-flight budget check. */
function estimateCeiling(opts: ThinkOptions): number {
  const model = opts.model ?? 'gpt-4o-mini';
  // Assume at most ~8k input and ~2k output tokens unless a tighter cap is set.
  const outTokens = opts.maxTokens ?? 2_000;
  return priceOf(model, 8_000, outTokens);
}

export async function think(opts: ThinkOptions): Promise<ChatResult> {
  const ceiling = estimateCeiling(opts);
  await assertCanSpend(ceiling, `llm:${opts.purpose}`);
  // Owner controls: per-task ceiling, daily/monthly windows and the rolling
  // model-call cap all apply on top of the global hard cap.
  await assertTaskCostAllowed(ceiling, `llm:${opts.purpose}`);
  await assertModelCallAllowed();

  const messages: ChatMessage[] = opts.system
    ? [{ role: 'system', content: opts.system }, ...opts.messages]
    : opts.messages;

  const started = Date.now();
  let result: ChatResult | null = null;
  let error: string | null = null;
  try {
    result = await routeChat(opts.provider, {
      messages,
      model: opts.model,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      json: opts.json,
    });
    return result;
  } catch (err) {
    error = (err as Error).message;
    throw err;
  } finally {
    const cost = result?.costUsd ?? 0;
    try {
      await prisma.providerCall.create({
        data: {
          provider: result?.provider ?? (opts.provider ?? 'openai'),
          model: result?.model ?? (opts.model ?? 'unknown'),
          purpose: opts.purpose,
          taskId: opts.taskId ?? null,
          inputTokens: result?.inputTokens ?? 0,
          outputTokens: result?.outputTokens ?? 0,
          costUsd: cost,
          latencyMs: result?.latencyMs ?? Date.now() - started,
          ok: error === null,
          error,
        },
      });
      if (cost > 0) await recordSpend(cost, `llm:${opts.purpose}`);
      // Also record the model spend on the finance ledger as AI_COST, so the
      // financial report's AI-spend line is real (it was always 0 before). The
      // budget counter and the ledger are two views of the same fact.
      if (cost > 0) {
        await recordLedger({
          kind: 'AI_COST',
          amountUsd: cost,
          provider: result?.provider ?? (opts.provider ?? 'openai'),
          evidence: { purpose: opts.purpose, model: result?.model ?? 'unknown', taskId: opts.taskId ?? null },
        });
      }
    } catch (logErr) {
      logger.error('failed to record provider call', { error: (logErr as Error).message });
    }
  }
}

/** Parse a JSON object from a model reply, tolerating markdown fences. */
export function parseJson<T>(content: string): T {
  const trimmed = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(trimmed) as T;
}
