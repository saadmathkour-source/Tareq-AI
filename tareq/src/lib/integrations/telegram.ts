import { env, hasSecret } from '../env.ts';
import { audit } from '../core/audit.ts';
import { ForbiddenError } from '../core/errors.ts';

/**
 * Telegram integration (section 18).
 *
 * The bot talks to the *same* agent: it authenticates the owner by Telegram user
 * id, then calls the owner API. There is no second brain and no second memory.
 * Commands are read-mostly; anything that changes state goes through the same
 * permission engine and approval flow as the dashboard.
 *
 * The bot token lives in the environment and is never logged.
 */

export interface TelegramConfig {
  token: string;
  ownerId: string;
}

export function config(): TelegramConfig | null {
  if (!hasSecret('TELEGRAM_BOT_TOKEN') || !hasSecret('TELEGRAM_OWNER_ID')) return null;
  return { token: process.env.TELEGRAM_BOT_TOKEN!, ownerId: process.env.TELEGRAM_OWNER_ID! };
}

const API = 'https://api.telegram.org';

export const COMMANDS = [
  '/status',
  '/tasks',
  '/opportunities',
  '/revenue',
  '/costs',
  '/approvals',
  '/pause',
  '/resume',
  '/stop',
  '/help',
] as const;

/** Reject anyone who is not the configured owner. */
export function assertOwner(userId: number | string): void {
  const cfg = config();
  if (!cfg) throw new ForbiddenError('Telegram is not configured');
  if (String(userId) !== cfg.ownerId) {
    void audit({ actorType: 'system', action: 'telegram.unauthorized', target: String(userId), severity: 'warn' });
    throw new ForbiddenError('Unauthorized Telegram user');
  }
}

async function call(method: string, payload: Record<string, unknown>): Promise<unknown> {
  const cfg = config();
  if (!cfg) throw new ForbiddenError('Telegram is not configured');
  const res = await fetch(`${API}/bot${cfg.token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
  if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description ?? 'unknown'}`);
  return data.result;
}

export async function sendMessage(chatId: number | string, text: string): Promise<void> {
  await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
}

/** Notify the owner of an event that needs attention. No-op when unconfigured. */
export async function notifyOwner(text: string): Promise<void> {
  const cfg = config();
  if (!cfg) return;
  try {
    await sendMessage(cfg.ownerId, text);
  } catch {
    // Notification failure must never break the caller.
  }
}

/** Map a Telegram command to the owner API path it should call. */
export function commandToApi(command: string): { method: string; path: string; body?: Record<string, unknown> } | null {
  const cmd = command.trim().split(/\s+/)[0];
  switch (cmd) {
    case '/status':
      return { method: 'GET', path: '/health?deep=1' };
    case '/tasks':
      return { method: 'GET', path: '/tasks' };
    case '/opportunities':
      return { method: 'GET', path: '/capabilities' };
    case '/revenue':
    case '/costs':
      return { method: 'GET', path: '/finance' };
    case '/approvals':
      return { method: 'GET', path: '/approvals' };
    case '/pause':
      return { method: 'POST', path: '/mode', body: { mode: 'OBSERVE' } };
    case '/resume':
      return { method: 'POST', path: '/mode', body: { mode: 'SUPERVISED' } };
    case '/stop':
      return { method: 'POST', path: '/emergency-stop' };
    case '/help':
      return { method: 'GET', path: '/help' };
    default:
      return null;
  }
}

/** Health probe used by the dashboard Integrations tab. */
export async function probeTelegram(): Promise<{ configured: boolean; ok: boolean; detail?: string }> {
  const cfg = config();
  if (!cfg) return { configured: false, ok: false, detail: 'not configured' };
  try {
    const res = await fetch(`${API}/bot${cfg.token}/getMe`);
    const data = (await res.json()) as { ok: boolean; result?: { username?: string } };
    return { configured: true, ok: data.ok, detail: data.result?.username };
  } catch (err) {
    return { configured: true, ok: false, detail: (err as Error).message.slice(0, 120) };
  }
}

/** Reference the env module so bundlers keep the import for future use. */
export const _envRef = env;
