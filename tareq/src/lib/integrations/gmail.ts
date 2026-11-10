import { hasSecret } from '../env.ts';

/**
 * Gmail adapter (section 19) — send-only, via the owner's own OAuth credentials.
 *
 * TAREQ never stores a Google password. It uses a refresh token that the owner
 * authorises out of band, exchanges it for a short-lived access token, and sends
 * through the owner's mailbox. Sending is a high-risk action: callers must have
 * an owner approval before `send()` is reached (enforced in the worker).
 *
 * Without configured credentials every method reports `configured: false` and
 * `send()` refuses — it never pretends to have sent anything.
 */

export interface GmailStatus {
  configured: boolean;
  sender: string | null;
  missing: string[];
}

const REQUIRED = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'GMAIL_SENDER'] as const;

export function status(): GmailStatus {
  const missing = REQUIRED.filter((n) => !hasSecret(n));
  return {
    configured: missing.length === 0,
    sender: process.env.GMAIL_SENDER ?? null,
    missing,
  };
}

async function accessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });
  const data = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Gmail token exchange failed: ${data.error_description ?? res.status}`);
  }
  return data.access_token;
}

/**
 * Verify the OAuth credentials by exchanging the refresh token for an access
 * token. This proves the credentials work without sending or drafting anything.
 */
export async function probeToken(): Promise<{ ok: boolean; reason?: string }> {
  const st = status();
  if (!st.configured) return { ok: false, reason: `Gmail not configured (missing: ${st.missing.join(', ')})` };
  try {
    await accessToken();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

export interface SendResult {
  sent: boolean;
  to: string;
  provider: 'gmail';
  messageId?: string;
  reason?: string;
}

function mime(to: string, subject: string, body: string): string {
  return [
    `To: ${to}`,
    `From: ${process.env.GMAIL_SENDER}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
  ].join('\r\n');
}

/**
 * Create a draft in the owner's mailbox. Drafting is not sending: it never
 * leaves the mailbox and needs no external approval. Returns the draft id so it
 * can be retrieved and verified before any send.
 */
export async function createDraft(to: string, subject: string, body: string): Promise<{ ok: boolean; draftId?: string; reason?: string }> {
  const st = status();
  if (!st.configured) return { ok: false, reason: `Gmail not configured (missing: ${st.missing.join(', ')})` };
  const token = await accessToken();
  const raw = Buffer.from(mime(to, subject, body)).toString('base64url');
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: { raw } }),
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok || !data.id) return { ok: false, reason: data.error?.message ?? `HTTP ${res.status}` };
  return { ok: true, draftId: data.id };
}

/** Retrieve a draft by id, so a created draft can be verified before sending. */
export async function getDraft(draftId: string): Promise<{ ok: boolean; id?: string; reason?: string }> {
  const st = status();
  if (!st.configured) return { ok: false, reason: `Gmail not configured (missing: ${st.missing.join(', ')})` };
  const token = await accessToken();
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok || !data.id) return { ok: false, reason: data.error?.message ?? `HTTP ${res.status}` };
  return { ok: true, id: data.id };
}

/**
 * Send one plain-text email. Requires owner approval to have been granted
 * already — this function does not check approvals itself; the worker does.
 */
export async function send(to: string, subject: string, body: string): Promise<SendResult> {
  const st = status();
  if (!st.configured) {
    return { sent: false, to, provider: 'gmail', reason: `Gmail not configured (missing: ${st.missing.join(', ')})` };
  }
  const token = await accessToken();
  const raw = Buffer.from(mime(to, subject, body)).toString('base64url');
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok || !data.id) {
    return { sent: false, to, provider: 'gmail', reason: data.error?.message ?? `HTTP ${res.status}` };
  }
  return { sent: true, to, provider: 'gmail', messageId: data.id };
}
