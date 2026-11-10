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

export type GmailFailureCode = 'missing_config' | 'invalid_grant' | 'invalid_client' | 'unauthorized_client' |
  'invalid_request' | 'invalid_scope' | 'access_denied' | 'admin_policy_enforced' | 'invalid_rapt' |
  'rate_limited' | 'timeout' | 'network_error' | 'invalid_response' | 'provider_error';
export type GmailSendPermission = 'granted' | 'missing' | 'not_reported';
const GOOGLE_ERROR_CODES = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client', 'invalid_request', 'invalid_scope', 'access_denied', 'admin_policy_enforced']);
const SEND_SCOPES = new Set(['https://mail.google.com/', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.modify']);

class GmailConnectionError extends Error {
  readonly code: GmailFailureCode;
  readonly httpStatus?: number;
  constructor(code: GmailFailureCode, httpStatus?: number) {
    // Do not copy Google's error_description or arbitrary response text into logs.
    super(`Gmail connection failed: ${code}`);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

async function tokenMetadata(): Promise<{ token: string; sendPermission: GmailSendPermission }> {
  let res: Response;
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
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
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    throw new GmailConnectionError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error');
  }
  let data: { access_token?: unknown; scope?: unknown; error?: unknown; error_subtype?: unknown };
  try { data = await res.json() as typeof data; }
  catch { throw new GmailConnectionError('invalid_response', res.status); }
  if (!data || typeof data !== 'object') throw new GmailConnectionError('invalid_response', res.status);
  if (!res.ok) {
    const code: GmailFailureCode = data.error_subtype === 'invalid_rapt' ? 'invalid_rapt'
      : typeof data.error === 'string' && GOOGLE_ERROR_CODES.has(data.error) ? data.error as GmailFailureCode
      : res.status === 429 ? 'rate_limited' : 'provider_error';
    throw new GmailConnectionError(code, res.status);
  }
  if (typeof data.access_token !== 'string' || !data.access_token) throw new GmailConnectionError('invalid_response', res.status);
  const scopes = typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : null;
  return { token: data.access_token, sendPermission: scopes ? (scopes.some((scope) => SEND_SCOPES.has(scope)) ? 'granted' : 'missing') : 'not_reported' };
}

async function accessToken(): Promise<string> {
  return (await tokenMetadata()).token;
}

/**
 * Verify the OAuth credentials by exchanging the refresh token for an access
 * token. This proves the credentials work without sending or drafting anything.
 */
export async function probeToken(): Promise<{ ok: boolean; reason?: string; code?: GmailFailureCode; httpStatus?: number; sendPermission?: GmailSendPermission }> {
  const st = status();
  if (!st.configured) return { ok: false, code: 'missing_config', reason: 'Gmail credentials are incomplete' };
  try {
    const metadata = await tokenMetadata();
    return { ok: true, sendPermission: metadata.sendPermission };
  } catch (err) {
    const failure = err instanceof GmailConnectionError ? err : new GmailConnectionError('provider_error');
    return { ok: false, code: failure.code, httpStatus: failure.httpStatus, reason: failure.message };
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
