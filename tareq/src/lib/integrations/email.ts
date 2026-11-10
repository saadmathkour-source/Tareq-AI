import { hasSecret } from '../env.ts';
import { logger } from '../core/logger.ts';
import * as gmail from './gmail.ts';

/**
 * Transactional email abstraction for customer-facing delivery.
 *
 * Two providers are supported, selected at runtime from `process.env` (the
 * application never reads a secret at import time, so tests can configure a
 * provider per case):
 *
 *  - `resend` — the Resend HTTPS API, keyed by `RESEND_API_KEY` (+ `EMAIL_FROM`).
 *    Preferred for transactional mail because it needs no OAuth round-trip.
 *  - `gmail`  — the owner's Gmail OAuth mailbox (see `gmail.ts`), keyed by the
 *    `GMAIL_*` variables.
 *
 * `EMAIL_PROVIDER` may force one explicitly. When neither is configured the
 * adapter reports `configured: false` and `send()` refuses — it never pretends a
 * message was sent.
 *
 * The `EMAIL_*` names below are canonical. A deployment that only has the
 * Gmail names (or vice-versa) is still supported because `status()` reports the
 * exact missing names and the caller can map them.
 */

export type EmailProvider = 'resend' | 'gmail' | 'none';

export interface EmailStatus {
  configured: boolean;
  provider: EmailProvider;
  from: string | null;
  missing: string[];
}

const RESEND_REQUIRED = ['RESEND_API_KEY', 'EMAIL_FROM'] as const;

/** Resolve the sender address from whichever variable the deployment provides. */
function senderAddress(): string | null {
  return process.env.EMAIL_FROM ?? process.env.GMAIL_SENDER ?? process.env.EMAIL_SENDER ?? null;
}

function resendConfigured(): boolean {
  return hasSecret('RESEND_API_KEY') && Boolean(senderAddress());
}

function gmailConfigured(): boolean {
  return gmail.status().configured;
}

/** Which provider is active, and what (if anything) is missing to enable one. */
export function status(): EmailStatus {
  const forced = process.env.EMAIL_PROVIDER;
  const from = senderAddress();

  if (forced === 'resend') {
    const missing = RESEND_REQUIRED.filter((n) => (n === 'EMAIL_FROM' ? !senderAddress() : !hasSecret(n)));
    return { configured: missing.length === 0, provider: 'resend', from, missing };
  }
  if (forced === 'gmail') {
    return { configured: gmailConfigured(), provider: 'gmail', from, missing: gmail.status().missing };
  }
  if (resendConfigured()) return { configured: true, provider: 'resend', from, missing: [] };
  if (gmailConfigured()) return { configured: true, provider: 'gmail', from, missing: [] };

  // Nothing configured: report the names that would enable the preferred path.
  const missing = [...RESEND_REQUIRED.filter((n) => (n === 'EMAIL_FROM' ? !senderAddress() : !hasSecret(n))), ...gmail.status().missing];
  return { configured: false, provider: 'none', from, missing };
}

export interface SendInput {
  to: string;
  subject: string;
  text: string;
}

export interface SendOutcome {
  sent: boolean;
  provider: EmailProvider;
  to: string;
  messageId?: string;
  reason?: string;
}

function mime(to: string, subject: string, text: string): string {
  const from = senderAddress() ?? '';
  return [`To: ${to}`, `From: ${from}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset="UTF-8"', '', text].join('\r\n');
}

async function sendViaResend(input: SendInput): Promise<SendOutcome> {
  const key = process.env.RESEND_API_KEY!;
  const from = senderAddress()!;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: input.to, subject: input.subject, text: input.text }),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string; error?: { message?: string } };
  if (!res.ok || !data.id) {
    return { sent: false, provider: 'resend', to: input.to, reason: data.error?.message ?? data.message ?? `HTTP ${res.status}` };
  }
  return { sent: true, provider: 'resend', to: input.to, messageId: data.id };
}

async function sendViaGmail(input: SendInput): Promise<SendOutcome> {
  const r = await gmail.send(input.to, input.subject, input.text);
  return { sent: r.sent, provider: 'gmail', to: input.to, messageId: r.messageId, reason: r.reason };
}

/** Send one transactional email. Never throws for a provider failure. */
export async function send(input: SendInput): Promise<SendOutcome> {
  const st = status();
  if (!st.configured) {
    return { sent: false, provider: 'none', to: input.to, reason: `Email not configured (missing: ${st.missing.join(', ')})` };
  }
  try {
    return st.provider === 'gmail' ? await sendViaGmail(input) : await sendViaResend(input);
  } catch (err) {
    logger.warn('email send threw', { provider: st.provider, error: (err as Error).message });
    return { sent: false, provider: st.provider, to: input.to, reason: (err as Error).message };
  }
}

/**
 * Verify the provider connection WITHOUT sending anything to a customer.
 *
 *  - resend: lists the account's domains (`GET /domains`); a 200 proves the key
 *    is valid. It never creates or sends a message.
 *  - gmail:  performs the OAuth refresh-token exchange only; a token proves the
 *    credentials work without sending or even drafting mail.
 */
export async function verify(): Promise<{ ok: boolean; provider: EmailProvider; reason?: string }> {
  const st = status();
  if (!st.configured) return { ok: false, provider: st.provider, reason: `not configured (missing: ${st.missing.join(', ')})` };
  try {
    if (st.provider === 'resend') {
      const res = await fetch('https://api.resend.com/domains', { headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}` }, signal: AbortSignal.timeout(15_000) });
      return { ok: res.ok, provider: 'resend', reason: res.ok ? undefined : `HTTP ${res.status}` };
    }
    const token = await gmail.probeToken();
    return { ok: token.ok, provider: 'gmail', reason: token.reason };
  } catch (err) {
    return { ok: false, provider: st.provider, reason: (err as Error).message };
  }
}

/** Exposed for callers that need the raw MIME (e.g. auditing). */
export { mime };
