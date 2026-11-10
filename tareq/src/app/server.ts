/**
 * TAREQ owner API.
 *
 * A dependency-free HTTP server (node:http) exposing the owner-control surface:
 * authentication, operating mode, approvals, tasks, capabilities, finance,
 * health, audit and the emergency stop. Every route except `/health` and
 * `/auth/login` requires a valid owner session.
 *
 * Owner-only by construction: there is no route that lets a non-owner issue
 * admin commands, and the agent's own tokens cannot call these endpoints.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { env } from '../lib/env.ts';
import { logger } from '../lib/core/logger.ts';
import { authenticate, assertSessionLive, login, logout, revokeAllSessions, type OwnerIdentity } from '../lib/security/owner-auth.ts';
import { currentMode, setMode, type OperatingMode } from '../lib/security/permissions.ts';
import { health, capabilityTable } from '../lib/observability/health.ts';
import { stats as queueStats, cancel } from '../lib/queue/tasks.ts';
import { summary as financeSummary, acquisitionMetrics } from '../lib/finance/ledger.ts';
import { financialReport } from '../lib/finance/report.ts';
import { snapshot as budgetSnapshot } from '../lib/security/budget.ts';
import { prisma } from '../lib/core/db.ts';
import { verifyChain } from '../lib/core/audit.ts';
import { audit } from '../lib/core/audit.ts';
import { TareqError, ForbiddenError, ValidationError } from '../lib/core/errors.ts';
import { plan, planFromCommand } from '../lib/planner/index.ts';
import { runMission } from '../lib/commercial/mission.ts';
import { status as gmailStatus } from '../lib/integrations/gmail.ts';
import { status as emailStatus } from '../lib/integrations/email.ts';
import { status as hubspotStatus } from '../lib/integrations/hubspot.ts';
import { status as stripeStatus, handleWebhook, createTestPaymentLink } from '../lib/integrations/stripe.ts';
import { listProducts, getPublishedProduct, seedProducts, publishProduct } from '../lib/commercial/products.ts';
import { generateLanding } from '../lib/commercial/landing.ts';
import { draftArticle, publishArticle, listPublishedArticles, getPublishedArticle, listAllArticles } from '../lib/commercial/publishing.ts';
import { createInquiry, answerInquiry, listInquiries } from '../lib/commercial/inquiries.ts';
import { createOrder, attachCheckout, listOrders, orderStats } from '../lib/commercial/orders.ts';
import { getArtifact, redeemDownloadToken } from '../lib/commercial/delivery.ts';
import { createPublicCheckout, getPublicOrderStatus } from '../lib/commercial/checkout.ts';
import { rateLimit } from '../lib/security/rate-limit.ts';
import { checkLoginAllowed, recordLoginFailure, recordLoginSuccess } from '../lib/security/login-guard.ts';
import { publicBaseUrl } from '../lib/commercial/delivery.ts';
import { commercialOverview } from '../lib/commercial/overview.ts';
import { getControls, setControls, windowUsage, DEFAULT_CONTROLS, controlStatus, type Controls } from '../lib/security/controls.ts';
import { openFindings, resolveFinding, runWatchdog } from '../lib/core/supervisor.ts';
import { optimizationReport, commercialReadiness, type ProductPerformance } from '../lib/commercial/optimization.ts';
import { run } from '../lib/core/orchestrator.ts';
import { bootstrapWorker } from '../lib/core/worker-boot.ts';
import { startScheduler } from '../lib/queue/scheduler.ts';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { shopHtml, thanksHtml, legalHtml, notFoundHtml, buyHtml, downloadHtml, insightsHtml, articleHtml, contactHtml } from './storefront.ts';

const PORT = Number(process.env.PORT ?? 3300);

/**
 * Emergency owner-auth bypass.
 *
 * Set `TAREQ_AUTH_BYPASS=1` to drop the sign-in screen and treat every
 * owner-only route as already owned. It exists ONLY as a temporary lockout
 * recovery switch: it removes the last barrier between a public URL and owner
 * powers (spending, outreach, publishing), so it is logged loudly at startup
 * and MUST be switched off as soon as access is restored. Default: off.
 *
 * `bypassRequested` is the raw environment flag. `authBypass()` is the flag
 * *after* the safety gate: even when the flag is set, the bypass is refused
 * once an owner account exists, because the owner can sign in normally — a
 * forgotten `TAREQ_AUTH_BYPASS=1` must never leave a live deployment open.
 */
function bypassRequested(): boolean {
  return process.env.TAREQ_AUTH_BYPASS === '1';
}

let bypassAllowed = false;

function authBypass(): boolean {
  return bypassRequested() && bypassAllowed;
}

/**
 * Decide whether the bypass may take effect. It is permitted ONLY when no owner
 * exists (genuine lockout recovery); otherwise it is force-disabled and warned
 * about loudly. `countOwners` is injectable so the decision is unit-testable
 * without touching the database.
 */
export async function resolveAuthBypass(countOwners: () => Promise<number> = () => prisma.owner.count()): Promise<void> {
  if (!bypassRequested()) {
    logger.info('owner auth bypass off');
    return;
  }
  try {
    const owners = await countOwners();
    if (owners > 0) {
      bypassAllowed = false;
      logger.error(
        'OWNER AUTH BYPASS REFUSED: TAREQ_AUTH_BYPASS=1 is set but an owner already exists. ' +
          'Enforcing normal sign-in. Set TAREQ_AUTH_BYPASS=0 in production.',
        { owners },
      );
      return;
    }
  } catch (err) {
    // Fail closed: if we cannot confirm there is no owner, do not open the app.
    bypassAllowed = false;
    logger.error('OWNER AUTH BYPASS REFUSED: could not verify owner state; failing closed', {
      error: (err as Error).message,
    });
    return;
  }
  bypassAllowed = true;
  logger.warn('OWNER AUTH BYPASS ENABLED (no owner exists): every owner-only route is open for lockout recovery. Create the owner and set TAREQ_AUTH_BYPASS=0.');
}

const BYPASS_OWNER: OwnerIdentity = {
  id: 'auth-bypass',
  email: process.env.TAREQ_OWNER_EMAIL ?? 'owner',
  displayName: 'Auth bypass (owner lockout recovery)',
  locale: 'ar',
};

/**
 * The dashboard is a single static HTML file served by this same server, so the
 * owner UI has no separate build step and no second deployment. It is public
 * HTML (no data), and every datum it shows comes from an authenticated API call.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
let dashboardHtml: string | null = null;
function dashboard(): string {
  if (dashboardHtml === null) {
    dashboardHtml = readFileSync(join(HERE, 'dashboard.html'), 'utf8');
  }
  return dashboardHtml;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html) });
  res.end(html);
}

/**
 * Map a thrown error to an HTTP status. Kept as a pure function so it can be
 * unit-tested without a running server. Anything that is not a typed TareqError
 * is treated as an internal fault (500).
 */
export function statusForError(err: unknown): { status: number; body: { error: string; code?: string } } {
  if (err instanceof ForbiddenError) return { status: 401, body: { error: 'unauthorized' } };
  if (err instanceof ValidationError) return { status: 400, body: { error: err.message, code: err.code } };
  if (err instanceof TareqError) return { status: 422, body: { error: err.message, code: err.code } };
  return { status: 500, body: { error: 'internal error' } };
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Read a raw body (up to a small cap) as UTF-8 text, for form submissions. */
async function readRawBody(req: IncomingMessage, maxBytes = 16 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) throw new ValidationError('request body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Parse a form body that may be urlencoded (browser form) or JSON. */
export function parseFormBody(raw: string, contentType: string): Record<string, unknown> {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('application/json')) {
    try {
      return JSON.parse(raw || '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
  return out;
}

/** Best-effort client IP for rate limiting (behind Railway's proxy). */
function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : fwd;
  if (typeof first === 'string' && first.length > 0) return first.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

/** Public base URL for building redirect links, from config or the request. */
function baseUrlFromReq(req: IncomingMessage): string {
  const configured = publicBaseUrl('');
  if (configured) return configured;
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || 'http';
  const host = (req.headers['host'] as string | undefined) || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers['authorization'];
  if (typeof h !== 'string' || !h.startsWith('Bearer ')) return null;
  return h.slice('Bearer '.length).trim();
}

type Handler = (req: IncomingMessage, res: ServerResponse, owner: OwnerIdentity | null, body: Record<string, unknown>) => Promise<void>;

const routes: Array<{ method: string; path: string; auth: boolean; handler: Handler }> = [];

function route(method: string, path: string, auth: boolean, handler: Handler): void {
  routes.push({ method, path, auth, handler });
}

// --- public ----------------------------------------------------------------
route('GET', '/health', false, async (req, res) => {
  const deep = new URL(req.url ?? '/', 'http://x').searchParams.get('deep') === '1';
  const report = await health({ deep });
  json(res, report.ok ? 200 : 503, report);
});

// Alias so platform health probes that expect `/api/health` also succeed.
route('GET', '/api/health', false, async (req, res) => {
  const deep = new URL(req.url ?? '/', 'http://x').searchParams.get('deep') === '1';
  const report = await health({ deep });
  json(res, report.ok ? 200 : 503, report);
});

route('POST', '/auth/login', false, async (req, res, _o, body) => {
  const key = clientIp(req);
  const gate = checkLoginAllowed(key);
  if (!gate.ok) {
    res.setHeader('Retry-After', String(Math.ceil(gate.retryAfterMs / 1000)));
    return json(res, 429, { error: 'too many attempts; try again later' });
  }
  const email = String(body['email'] ?? '');
  const password = String(body['password'] ?? '');
  try {
    const { token, owner } = await login(email, password);
    recordLoginSuccess(key);
    json(res, 200, { token, owner });
  } catch (err) {
    // A failed login (bad credentials) is counted; anything else is not, so an
    // infrastructure error cannot lock the real owner out.
    if (err instanceof ForbiddenError) recordLoginFailure(key);
    throw err;
  }
});

// --- owner-only ------------------------------------------------------------
route('POST', '/auth/logout', true, async (req, res) => {
  const t = bearer(req);
  if (t) await logout(t);
  json(res, 200, { ok: true });
});

route('POST', '/auth/revoke-all', true, async (_req, res, owner) => {
  const count = await revokeAllSessions(owner!.id);
  json(res, 200, { ok: true, revoked: count });
});

route('GET', '/mode', true, async (_req, res) => {
  json(res, 200, { mode: await currentMode() });
});

route('POST', '/mode', true, async (_req, res, owner, body) => {
  const mode = String(body['mode'] ?? '') as OperatingMode;
  const allowed: OperatingMode[] = ['OBSERVE', 'PLAN', 'SANDBOX', 'SUPERVISED', 'AUTONOMOUS'];
  if (!allowed.includes(mode)) return json(res, 400, { error: 'invalid mode' });
  await setMode(mode, owner!.id);
  json(res, 200, { ok: true, mode });
});

route('GET', '/capabilities', true, async (_req, res) => {
  json(res, 200, capabilityTable());
});

route('GET', '/integrations', true, async (_req, res) => {
  json(res, 200, {
    gmail: gmailStatus(),
    email: emailStatus(),
    hubspot: hubspotStatus(),
    stripe: stripeStatus(),
    telegram: { configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_OWNER_ID) },
  });
});

route('GET', '/tasks', true, async (_req, res) => {
  const [stats, recent] = await Promise.all([
    queueStats(),
    prisma.task.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  json(res, 200, { stats, recent });
});

route('POST', '/tasks/cancel', true, async (_req, res, owner, body) => {
  const id = String(body['id'] ?? '');
  if (!id) return json(res, 400, { error: 'id required' });
  await cancel(id, `cancelled by ${owner!.email}`);
  await audit({ actorType: 'owner', actorId: owner!.id, action: 'task.cancelled', target: id, severity: 'warn' });
  json(res, 200, { ok: true });
});

route('GET', '/approvals', true, async (_req, res) => {
  const rows = await prisma.approval.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  json(res, 200, { approvals: rows });
});

route('POST', '/approvals/decide', true, async (_req, res, owner, body) => {
  const id = String(body['id'] ?? '');
  const decision = String(body['decision'] ?? '');
  const note = body['note'] ? String(body['note']) : null;
  if (!['APPROVED', 'REJECTED'].includes(decision)) return json(res, 400, { error: 'decision must be APPROVED or REJECTED' });
  const approval = await prisma.approval.update({
    where: { id },
    data: { status: decision as 'APPROVED' | 'REJECTED', decidedBy: owner!.email, decidedAt: new Date(), decisionNote: note },
  });
  await audit({ actorType: 'owner', actorId: owner!.id, action: `approval.${decision.toLowerCase()}`, target: id, severity: 'warn' });
  json(res, 200, { ok: true, approval });
});

route('GET', '/finance', true, async (_req, res) => {
  const [summary, budget, acq] = await Promise.all([financeSummary(), budgetSnapshot(), acquisitionMetrics()]);
  const [dealTotal, dealWon, pipeline, calls, callCost] = await Promise.all([
    prisma.deal.count(),
    prisma.deal.count({ where: { status: 'WON' } }),
    prisma.deal.aggregate({ where: { status: { in: ['PROPOSED', 'NEGOTIATION'] } }, _sum: { valueUsd: true } }),
    prisma.providerCall.count(),
    prisma.providerCall.aggregate({ _sum: { costUsd: true } }),
  ]);
  json(res, 200, {
    summary,
    budget,
    acquisition: acq,
    deals: { count: dealTotal, wonCount: dealWon, pipelineUsd: Number(pipeline._sum.valueUsd ?? 0) },
    api: { calls, costUsd: Number(callCost._sum.costUsd ?? 0) },
  });
});

/** API usage and cost monitoring by provider and purpose. */
route('GET', '/usage', true, async (_req, res) => {
  const [byProvider, byPurpose, recent] = await Promise.all([
    prisma.providerCall.groupBy({ by: ['provider'], _count: { _all: true }, _sum: { costUsd: true, inputTokens: true, outputTokens: true } }),
    prisma.providerCall.groupBy({ by: ['purpose'], _count: { _all: true }, _sum: { costUsd: true } }),
    prisma.providerCall.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
  ]);
  json(res, 200, {
    byProvider: byProvider.map((r) => ({ provider: r.provider, calls: r._count._all, costUsd: Number(r._sum.costUsd ?? 0), inputTokens: r._sum.inputTokens ?? 0, outputTokens: r._sum.outputTokens ?? 0 })),
    byPurpose: byPurpose.map((r) => ({ purpose: r.purpose, calls: r._count._all, costUsd: Number(r._sum.costUsd ?? 0) })),
    recent,
  });
});

/** Lead and customer management. */
route('GET', '/leads', true, async (_req, res) => {
  const [leads, buyers, drafts] = await Promise.all([
    prisma.lead.findMany({ orderBy: { score: 'desc' }, take: 100, include: { buyer: true } }),
    prisma.buyer.count(),
    prisma.outreachDraft.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  json(res, 200, { leads, buyers, drafts });
});

/** Error monitoring: dead letters, failed tasks, recent provider errors. */
route('GET', '/errors', true, async (_req, res) => {
  const [dead, failed, providerErrors] = await Promise.all([
    prisma.deadLetter.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.task.findMany({ where: { status: { in: ['FAILED', 'DEAD'] } }, orderBy: { updatedAt: 'desc' }, take: 50 }),
    prisma.providerCall.findMany({ where: { ok: false }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  json(res, 200, { deadLetters: dead, failedTasks: failed, providerErrors });
});

/** Agent configuration: sub-agents, schedules, budget, mode, integrations. */
route('GET', '/config', true, async (_req, res) => {
  const [agents, schedules, budget, mode] = await Promise.all([
    prisma.subAgent.findMany({ orderBy: { name: 'asc' } }),
    prisma.schedule.findMany({ orderBy: { name: 'asc' } }),
    budgetSnapshot(),
    currentMode(),
  ]);
  json(res, 200, {
    mode,
    budget,
    subAgents: agents.map((a) => ({ name: a.name, role: a.role, enabled: a.enabled, allowedTools: a.allowedTools, maxCostUsd: Number(a.maxCostUsd), maxAttempts: a.maxAttempts })),
    schedules: schedules.map((s) => ({ name: s.name, cron: s.cron, taskKind: s.taskKind, enabled: s.enabled, nextRunAt: s.nextRunAt })),
    integrations: {
      telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_OWNER_ID),
      openai: Boolean(process.env.OPENAI_API_KEY),
      deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
      defaultProvider: process.env.TAREQ_DEFAULT_PROVIDER ?? 'openai',
    },
  });
});

/** Research and opportunity reports. */
route('GET', '/research', true, async (_req, res) => {
  const [evidence, claims, opportunities, memory] = await Promise.all([
    prisma.memoryRecord.findMany({ where: { kind: 'MARKET_EVIDENCE' }, orderBy: { updatedAt: 'desc' }, take: 50 }),
    prisma.claim.findMany({ orderBy: { id: 'desc' }, take: 50 }),
    prisma.opportunity.findMany({ orderBy: { createdAt: 'desc' }, take: 50, include: { stageEvents: { orderBy: { startedAt: 'asc' } } } }),
    prisma.memoryRecord.count(),
  ]);
  json(res, 200, { evidence, claims, opportunities, memoryCount: memory });
});

route('GET', '/audit', true, async (_req, res) => {
  const [rows, chain] = await Promise.all([
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    verifyChain(),
  ]);
  json(res, 200, { chain, entries: rows });
});

route('POST', '/emergency-stop', true, async (_req, res, owner) => {
  // Drop to the safest mode, engage the control-layer kill switch, cancel
  // queued work and revoke sessions.
  await setMode('OBSERVE', owner!.id);
  await setControls({ emergencyStop: true }, owner!.id);
  const cancelled = await prisma.task.updateMany({
    where: { status: { in: ['PENDING', 'QUEUED', 'RETRYING'] } },
    data: { status: 'CANCELLED', error: 'emergency stop', finishedAt: new Date() },
  });
  await revokeAllSessions(owner!.id);
  await audit({ actorType: 'owner', actorId: owner!.id, action: 'emergency_stop', severity: 'critical', metadata: { cancelled: cancelled.count } });
  json(res, 200, { ok: true, mode: 'OBSERVE', emergencyStop: true, cancelled: cancelled.count });
});

/** Clear the kill switch (owner action). Mode stays OBSERVE until set separately. */
route('POST', '/resume', true, async (_req, res, owner) => {
  const controls = await setControls({ emergencyStop: false }, owner!.id);
  json(res, 200, { ok: true, emergencyStop: controls.emergencyStop });
});

route('POST', '/plan', true, async (_req, res, _owner, body) => {
  const goal = String(body['goal'] ?? '');
  const opportunityId = body['opportunityId'] ? String(body['opportunityId']) : undefined;
  if (!goal.trim()) return json(res, 400, { error: 'goal is required' });
  try {
    const { parentId, tasks, intent } = await planFromCommand(goal, opportunityId);
    json(res, 200, { ok: true, parentId, tasks, intent });
  } catch (err) {
    json(res, 400, { error: (err as Error).message });
  }
});

route('POST', '/mission', true, async (_req, res, owner, body) => {
  const topic = String(body['topic'] ?? body['goal'] ?? '').trim();
  if (!topic) return json(res, 400, { error: 'topic is required' });
  try {
    await audit({ actorType: 'owner', actorId: owner?.id, action: 'mission.start', target: topic, severity: 'warn' });
    const report = await runMission(topic, { maxBuyers: Number(body['maxBuyers'] ?? 20) || 20 });
    json(res, 200, { ok: true, report });
  } catch (err) {
    json(res, 400, { error: (err as Error).message });
  }
});

/**
 * Create a real, payable Stripe Checkout link for an offer. This only *creates*
 * a link; no money is recorded here. Revenue is recorded solely by the
 * signature-verified webhook at /webhooks/stripe.
 */
route('POST', '/payments/link', true, async (_req, res, owner, body) => {
  const amountUsd = Number(body['amountUsd']);
  const productName = String(body['productName'] ?? '').trim();
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return json(res, 400, { error: 'amountUsd must be a positive number' });
  if (!productName) return json(res, 400, { error: 'productName is required' });
  const base = String(body['baseUrl'] ?? `http://localhost:${PORT}`);
  const result = await createTestPaymentLink({
    amountUsd,
    productName,
    successUrl: String(body['successUrl'] ?? `${base}/?payment=success`),
    cancelUrl: String(body['cancelUrl'] ?? `${base}/?payment=cancelled`),
    clientReferenceId: body['dealId'] ? String(body['dealId']) : undefined,
  });
  if (!result.ok) return json(res, 400, { ok: false, error: result.reason });
  await audit({ actorType: 'owner', actorId: owner?.id, action: 'payment.link_created', target: result.id, severity: 'info', metadata: { amountUsd } });
  json(res, 200, { ok: true, url: result.url, id: result.id, mode: result.mode });
});

// --- commercial operation (Phase 16) ---------------------------------------

route('GET', '/commercial/overview', true, async (_req, res) => {
  json(res, 200, await commercialOverview());
});

// --- Phase 18: supervisor, controls, optimization, readiness ----------------

/** Supervisor findings (open) + a summary, for the dashboard. */
route('GET', '/supervisor', true, async (_req, res) => {
  const [findings, counts] = await Promise.all([
    openFindings(100),
    prisma.watchdogAlert.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);
  const byStatus: Record<string, number> = {};
  for (const c of counts) byStatus[c.status] = c._count._all;
  json(res, 200, { findings, byStatus });
});

/** Run the watchdog on demand (owner-triggered). */
route('POST', '/supervisor/run', true, async (_req, res, owner) => {
  const report = await runWatchdog();
  await audit({ actorType: 'owner', actorId: owner?.id, action: 'supervisor.run', severity: 'info', metadata: { findings: report.findings.length } });
  json(res, 200, { ok: true, ...report });
});

route('POST', '/supervisor/resolve', true, async (_req, res, owner, body) => {
  const id = String(body['id'] ?? '');
  if (!id) return json(res, 400, { error: 'id is required' });
  const ok = await resolveFinding(id, owner!.id);
  json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'finding not found or already resolved' });
});

/** Owner operational controls (budget windows, ad spend, discounts, kill switch). */
route('GET', '/controls', true, async (_req, res) => {
  const [controls, usage] = await Promise.all([getControls(), windowUsage()]);
  // `status` tells the client which controls are actually enforced at an action
  // point, so the dashboard can never show an unenforced switch as "on".
  json(res, 200, { controls, usage, defaults: DEFAULT_CONTROLS, status: controlStatus() });
});

route('POST', '/controls', true, async (_req, res, owner, body) => {
  try {
    // setControls validates every field and refuses to enable a control that has
    // no action path (NOT IMPLEMENTED), so an unsupported switch fails closed.
    const controls = await setControls(body as Partial<Controls>, owner!.id);
    json(res, 200, { ok: true, controls });
  } catch (err) {
    // ForbiddenError (a refused value) is a 400-class client error here.
    const status = err instanceof ForbiddenError ? 400 : statusForError(err).status;
    json(res, status, { error: (err as Error).message });
  }
});

/** Autonomous optimization: realised margin per product and recommendations. */
route('GET', '/optimization', true, async (_req, res) => {
  const products = await prisma.product.findMany({ include: { _count: { select: { orders: true } } } });
  const perf: ProductPerformance[] = [];
  for (const p of products) {
    const orders = await prisma.order.findMany({ where: { productId: p.id, status: 'DELIVERED' }, select: { amountUsd: true } });
    perf.push({
      slug: p.slug,
      name: p.name,
      priceUsd: Number(p.priceUsd),
      unitCostUsd: Number(p.costUsd),
      orders: p._count.orders,
      revenueUsd: orders.reduce((a, o) => a + Number(o.amountUsd), 0),
      costUsd: Number(p.costUsd) * orders.length,
    });
  }
  json(res, 200, optimizationReport(perf));
});

/**
 * Commercial readiness (Phase 18, section 12). Each item is backed by a real
 * database artefact, never by "the tests pass". An item with no artefact is
 * reported unverified, and any external blocker is surfaced verbatim.
 */
route('GET', '/readiness', true, async (_req, res) => {
  const verifiedClaims = await prisma.claim.count({ where: { publishable: true, verifiedAt: { not: null } } });
  const publishedProducts = await prisma.product.count({ where: { status: 'PUBLISHED' } });
  const leads = await prisma.lead.count();
  const approvedOutreach = await prisma.approval.count({ where: { action: 'outreach.send', status: 'APPROVED' } });
  const orders = await prisma.order.count();
  const delivered = await prisma.order.count({ where: { status: 'DELIVERED' } });
  const confirmed = await prisma.ledgerEntry.findMany({ where: { kind: 'REVENUE_CONFIRMED', verifiedAt: { not: null } }, select: { externalId: true, amountUsd: true } });
  const liveRevenue = confirmed.filter((r) => !String(r.externalId ?? '').includes('_test_'));
  const liveRevenueUsd = liveRevenue.reduce((a, r) => a + Number(r.amountUsd), 0);
  const publishedArticles = await prisma.article.count({ where: { status: 'PUBLISHED' } });
  const answeredInquiries = await prisma.inquiry.count({ where: { status: { in: ['ANSWERED', 'CLOSED'] } } });
  const report = await financialReport('all');

  const items = [
    { n: 1, name: 'discover a real opportunity with cited sources', verified: verifiedClaims > 0, evidence: `${verifiedClaims} verified claim(s)`, blockedBy: verifiedClaims > 0 ? undefined : 'needs a mission run that records evidence' },
    { n: 2, name: 'build a real sellable offer', verified: publishedProducts > 0, evidence: `${publishedProducts} published product(s)` },
    { n: 3, name: 'publish the product', verified: publishedProducts > 0, evidence: `${publishedProducts} published product(s)` },
    { n: 4, name: 'find a suitable prospect', verified: leads > 0, evidence: `${leads} lead(s)` },
    { n: 5, name: 'publish authorized organic content', verified: publishedArticles > 0, evidence: `${publishedArticles} published article(s)`, blockedBy: publishedArticles > 0 ? undefined : 'needs the owner to grant content publishing' },
    { n: 6, name: 'run a permitted marketing action', verified: approvedOutreach > 0, evidence: `${approvedOutreach} approved outreach approval(s)`, blockedBy: approvedOutreach > 0 ? undefined : 'outreach.send needs an owner approval and an email connector' },
    { n: 7, name: 'record a real response when it happens', verified: answeredInquiries > 0, evidence: `${answeredInquiries} answered inquiry(ies)`, blockedBy: answeredInquiries > 0 ? undefined : 'no inbound inquiry answered yet' },
    { n: 8, name: 'create a purchase order', verified: orders > 0, evidence: `${orders} order(s)` },
    { n: 9, name: 'receive a real LIVE payment', verified: liveRevenue.length > 0, evidence: `${liveRevenue.length} confirmed live payment(s), $${liveRevenueUsd.toFixed(2)}`, blockedBy: liveRevenue.length > 0 ? undefined : 'no live payment received yet' },
    { n: 10, name: 'fulfil and deliver the order', verified: delivered > 0, evidence: `${delivered} delivered order(s)`, blockedBy: delivered > 0 ? undefined : 'no order delivered yet' },
    { n: 11, name: 'compute profit after costs', verified: liveRevenue.length > 0, evidence: `net profit $${report.summary.netProfitUsd.toFixed(2)} over $${report.summary.grossRevenueUsd.toFixed(2)} collected`, blockedBy: liveRevenue.length > 0 ? undefined : 'no collected revenue to compute profit on' },
  ];
  json(res, 200, commercialReadiness(items));
});

route('GET', '/finance/report', true, async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const label = (url.searchParams.get('period') ?? 'all') as 'daily' | 'monthly' | 'all';
  json(res, 200, await financialReport(['daily', 'monthly', 'all'].includes(label) ? label : 'all'));
});

route('GET', '/products', true, async (_req, res) => {
  json(res, 200, { products: await listProducts(false) });
});

route('POST', '/products/seed', true, async (_req, res, owner) => {
  const count = await seedProducts();
  const products = await listProducts(false);
  for (const p of products) if (p.status === 'PUBLISHED') await generateLanding(p.slug);
  await audit({ actorType: 'owner', actorId: owner?.id, action: 'products.seeded', severity: 'info', metadata: { count } });
  json(res, 200, { ok: true, count });
});

/**
 * Publish (or unpublish) a product. Server-side enforced: reaching this route
 * already required an owner session, but the *transition to PUBLISHED* is gated
 * again inside `publishProduct()` on the `publishingAllowed` control AND the
 * `offer.publish` approval — so a route caller cannot bypass the controls, and
 * neither can the scheduled catalog task. Non-PUBLISHED transitions (DRAFT,
 * PAUSED, ARCHIVED) are plain owner state changes and are not gated.
 */
route('POST', '/products/publish', true, async (_req, res, owner, body) => {
  const slug = String(body['slug'] ?? '');
  const status = String(body['status'] ?? 'PUBLISHED');
  if (!slug) return json(res, 400, { error: 'slug is required' });
  if (!['DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED'].includes(status)) return json(res, 400, { error: 'invalid status' });
  const product = await prisma.product.findUnique({ where: { slug } });
  if (!product) return json(res, 404, { error: 'product not found' });
  if (status === 'PUBLISHED') {
    // Gated: throws ForbiddenError (401) when publishing is off, or
    // ApprovalRequiredError (422) when the offer.publish approval is missing.
    await publishProduct(slug, { actorType: 'owner', actorId: owner?.id });
    await generateLanding(slug);
    return json(res, 200, { ok: true, slug, status });
  }
  await prisma.product.update({ where: { slug }, data: { status: status as never } });
  await audit({ actorType: 'owner', actorId: owner?.id, action: 'product.status', target: slug, severity: 'warn', metadata: { status } });
  json(res, 200, { ok: true, slug, status });
});

route('POST', '/products/landing', true, async (_req, res, _owner, body) => {
  const slug = String(body['slug'] ?? '');
  if (!slug) return json(res, 400, { error: 'slug is required' });
  await generateLanding(slug);
  json(res, 200, { ok: true, slug });
});

// --- organic content & inbound (Phase 19) ----------------------------------

route('GET', '/content', true, async (_req, res) => {
  json(res, 200, { articles: await listAllArticles() });
});

/** Draft an article from real public signals. Drafting is safe; it never publishes. */
route('POST', '/content/draft', true, async (_req, res, owner, body) => {
  const topic = String(body['topic'] ?? '').trim();
  if (!topic) return json(res, 400, { error: 'topic is required' });
  const productSlug = body['productSlug'] ? String(body['productSlug']) : null;
  const { id, slug } = await draftArticle({ topic, productSlug });
  await audit({ actorType: 'owner', actorId: owner?.id, action: 'content.drafted', target: slug, metadata: { topic } });
  json(res, 200, { ok: true, id, slug });
});

/**
 * Publish a drafted article to TAREQ's own site. Gated inside `publishArticle()`
 * on the `contentPublishingAllowed` control and the emergency stop, so neither a
 * route caller nor the scheduler can publish without the owner's permission.
 */
route('POST', '/content/publish', true, async (_req, res, owner, body) => {
  const slug = String(body['slug'] ?? '');
  if (!slug) return json(res, 400, { error: 'slug is required' });
  const result = await publishArticle(slug, owner?.id ?? 'owner');
  json(res, 200, { ok: true, ...result });
});

route('GET', '/inquiries', true, async (_req, res) => {
  json(res, 200, { inquiries: await listInquiries() });
});

/** Answer (and, if email permission is granted, reply to) an inbound inquiry. */
route('POST', '/inquiries/answer', true, async (_req, res, owner, body) => {
  const id = String(body['id'] ?? '');
  if (!id) return json(res, 400, { error: 'id is required' });
  const result = await answerInquiry(id);
  await audit({ actorType: 'owner', actorId: owner?.id, action: 'inquiry.answered_by_owner', target: id, metadata: result });
  json(res, 200, { ok: true, ...result });
});

route('GET', '/orders', true, async (_req, res) => {
  const [orders, stats] = await Promise.all([listOrders(100), orderStats()]);
  json(res, 200, { orders, stats });
});

route('POST', '/orders', true, async (_req, res, owner, body) => {
  const slug = String(body['productSlug'] ?? body['slug'] ?? '');
  if (!slug) return json(res, 400, { error: 'productSlug is required' });
  try {
    const order = await createOrder({
      productSlug: slug,
      customerEmail: body['customerEmail'] ? String(body['customerEmail']) : undefined,
      customerName: body['customerName'] ? String(body['customerName']) : undefined,
      requirements: (body['requirements'] as Record<string, unknown>) ?? {},
    });
    await audit({ actorType: 'owner', actorId: owner?.id, action: 'order.created', target: order.id, severity: 'info' });
    json(res, 200, { ok: true, order });
  } catch (err) {
    json(res, 400, { error: (err as Error).message });
  }
});

/**
 * Create a Stripe LIVE Checkout session for a product order. This only creates a
 * payable link and returns its URL; the order stays AWAITING_PAYMENT until a
 * signature-verified webhook confirms collection. No charge is made here.
 */
route('POST', '/orders/checkout', true, async (_req, res, owner, body) => {
  const orderId = String(body['orderId'] ?? '');
  if (!orderId) return json(res, 400, { error: 'orderId is required' });
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { product: true } });
  if (!order) return json(res, 404, { error: 'order not found' });
  if (order.status === 'PAID' || order.status === 'DELIVERED') return json(res, 400, { error: `order already ${order.status}` });
  const base = String(body['baseUrl'] ?? `http://localhost:${PORT}`);
  const result = await createTestPaymentLink({
    amountUsd: Number(order.amountUsd),
    productName: order.product.name,
    successUrl: String(body['successUrl'] ?? `${base}/thanks?order=${order.id}`),
    cancelUrl: String(body['cancelUrl'] ?? `${base}/buy/${order.product.slug}?cancelled=1`),
    clientReferenceId: order.id,
  });
  if (!result.ok) return json(res, 400, { ok: false, error: result.reason });
  await attachCheckout(order.id, result.id ?? '', result.url ?? '');
  await audit({ actorType: 'owner', actorId: owner?.id, action: 'order.checkout_created', target: order.id, severity: 'info', metadata: { sessionId: result.id, mode: result.mode } });
  json(res, 200, { ok: true, url: result.url, sessionId: result.id, mode: result.mode, orderId: order.id });
});

route('GET', '/orders/artifact', true, async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const id = url.searchParams.get('id') ?? '';
  const artifact = id ? await getArtifact(id) : null;
  if (!artifact) return json(res, 404, { error: 'artifact not found' });
  json(res, 200, artifact);
});

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    // Owner dashboard (static shell; data comes from authenticated API calls).
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) {
      let html = dashboard();
      if (authBypass()) html = html.replace('<body>', '<body data-auth-bypass="1">');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html) });
      res.end(html);
      return;
    }

    // --- public storefront (Phase 16) --------------------------------------
    if (req.method === 'GET' && url.pathname === '/shop') {
      const products = await listProducts(true);
      return sendHtml(res, 200, shopHtml(products));
    }

    if (req.method === 'GET' && url.pathname.startsWith('/buy/')) {
      const slug = decodeURIComponent(url.pathname.slice('/buy/'.length));
      const product = await getPublishedProduct(slug);
      if (!product) return sendHtml(res, 404, notFoundHtml('Product not found'));
      if (product.landingHtml) return sendHtml(res, 200, product.landingHtml);
      await generateLanding(slug);
      const refreshed = await getPublishedProduct(slug);
      return sendHtml(res, 200, refreshed?.landingHtml ?? notFoundHtml('Product not found'));
    }

    // --- public checkout (Phase 17) ---------------------------------------
    // Purchase form. The price shown is read from the server-side product row.
    if (req.method === 'GET' && url.pathname.startsWith('/checkout/')) {
      const slug = decodeURIComponent(url.pathname.slice('/checkout/'.length));
      const product = await getPublishedProduct(slug);
      if (!product) return sendHtml(res, 404, notFoundHtml('Product not found'));
      return sendHtml(res, 200, buyHtml({ slug: product.slug, name: product.name, tagline: product.tagline, priceUsd: Number(product.priceUsd), currency: product.currency, requirements: product.requirements }));
    }

    // Create the order + Stripe Checkout Session, then send the buyer to pay.
    // Rate-limited per IP and per email so the endpoint cannot be flooded.
    if (req.method === 'POST' && url.pathname.startsWith('/checkout/')) {
      const slug = decodeURIComponent(url.pathname.slice('/checkout/'.length));
      const raw = await readRawBody(req);
      const form = parseFormBody(raw, String(req.headers['content-type'] ?? ''));
      const email = String(form['email'] ?? '');
      const ip = clientIp(req);

      const ipLimit = rateLimit(`checkout:ip:${ip}`, Number(process.env.TAREQ_CHECKOUT_RATE_LIMIT ?? 10) || 10, Number(process.env.TAREQ_CHECKOUT_RATE_WINDOW_MS ?? 60_000) || 60_000);
      if (!ipLimit.ok) {
        res.setHeader('retry-after', String(Math.ceil(ipLimit.retryAfterMs / 1000)));
        return sendHtml(res, 429, notFoundHtml('Too many checkout attempts. Please wait a moment and try again.'));
      }
      if (email) {
        const emailLimit = rateLimit(`checkout:email:${email.toLowerCase()}`, 3, 10 * 60_000);
        if (!emailLimit.ok) return sendHtml(res, 429, notFoundHtml('Too many checkout attempts for this email. Please try again shortly.'));
      }

      try {
        const result = await createPublicCheckout({
          slug,
          email,
          requirements: { topic: form['topic'], niche: form['niche'], market: form['market'], segment: form['segment'], geography: form['geography'], notes: form['notes'] },
          baseUrl: baseUrlFromReq(req),
        });
        res.writeHead(303, { location: result.url });
        res.end();
        return;
      } catch (err) {
        logger.warn('public checkout rejected', { error: (err as Error).message });
        return sendHtml(res, 400, notFoundHtml((err as Error).message));
      }
    }

    // Secure deliverable download. The token is unguessable and per-order, so a
    // buyer can only ever reach their own artifact.
    if (req.method === 'GET' && url.pathname.startsWith('/download/')) {
      const token = decodeURIComponent(url.pathname.slice('/download/'.length));
      const dl = rateLimit(`download:${clientIp(req)}`, 60, 60_000);
      if (!dl.ok) return sendHtml(res, 429, notFoundHtml('Too many requests. Please wait a moment.'));
      const found = await redeemDownloadToken(token);
      if (!found) return sendHtml(res, 404, notFoundHtml('This download link is invalid or has expired.'));
      if (url.searchParams.get('format') === 'json') {
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="${found.name.replace(/[^\w.-]/g, '_')}"`,
        });
        res.end(found.ref ?? '{}');
        return;
      }
      return sendHtml(res, 200, downloadHtml(found.name, found.ref ?? ''));
    }

    // Public, non-sensitive status for the buyer's own order page.
    if (req.method === 'GET' && url.pathname === '/orders/status') {
      const id = url.searchParams.get('order') ?? '';
      const st = id ? await getPublicOrderStatus(id) : null;
      if (!st) return json(res, 404, { error: 'order not found' });
      return json(res, 200, st);
    }

    if (req.method === 'GET' && url.pathname === '/thanks') {
      const orderId = url.searchParams.get('order') ?? '';
      const st = orderId ? await getPublicOrderStatus(orderId) : null;
      return sendHtml(res, 200, thanksHtml(orderId, st?.status ?? null));
    }

    if (req.method === 'GET' && url.pathname.startsWith('/legal/')) {
      const page = url.pathname.slice('/legal/'.length);
      const html = legalHtml(page);
      if (!html) return sendHtml(res, 404, notFoundHtml('Page not found'));
      return sendHtml(res, 200, html);
    }

    if (req.method === 'GET' && url.pathname === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('User-agent: *\nAllow: /\nDisallow: /orders\nDisallow: /commercial\nSitemap: ' + baseUrlFromReq(req) + '/sitemap.xml\n');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/sitemap.xml') {
      const base = baseUrlFromReq(req);
      const products = await listProducts(true);
      const articles = await listPublishedArticles();
      const urls = [
        { loc: `${base}/`, pri: '0.6' },
        { loc: `${base}/insights`, pri: '0.8' },
        { loc: `${base}/shop`, pri: '0.9' },
        { loc: `${base}/contact`, pri: '0.5' },
        ...products.map((p) => ({ loc: `${base}/buy/${p.slug}`, pri: '0.9' })),
        ...articles.map((a) => ({ loc: `${base}/insights/${a.slug}`, pri: '0.7' })),
      ];
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
        .map((u) => `  <url><loc>${u.loc.replace(/&/g, '&amp;')}</loc><priority>${u.pri}</priority></url>`)
        .join('\n')}\n</urlset>\n`;
      res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
      res.end(xml);
      return;
    }

    // --- organic publishing: TAREQ's own, owner-controlled content channel ----
    if (req.method === 'GET' && url.pathname === '/insights') {
      const articles = await listPublishedArticles();
      return sendHtml(res, 200, insightsHtml(articles));
    }

    if (req.method === 'GET' && url.pathname.startsWith('/insights/')) {
      const slug = decodeURIComponent(url.pathname.slice('/insights/'.length));
      const a = await getPublishedArticle(slug);
      if (!a) return sendHtml(res, 404, notFoundHtml('Article not found'));
      return sendHtml(res, 200, articleHtml(a));
    }

    // --- inbound: a visitor's own question (explicit consent, not outreach) ---
    if (req.method === 'GET' && url.pathname === '/contact') {
      const products = await listProducts(true);
      return sendHtml(res, 200, contactHtml({ products: products.map((p) => ({ slug: p.slug, name: p.name })) }));
    }

    if (req.method === 'POST' && url.pathname === '/contact') {
      const ip = clientIp(req);
      const limit = rateLimit(`contact:ip:${ip}`, 5, 60 * 60_000);
      if (!limit.ok) return sendHtml(res, 429, notFoundHtml('Too many messages. Please try again later.'));
      const raw = await readRawBody(req);
      const form = parseFormBody(raw, String(req.headers['content-type'] ?? ''));
      try {
        const { id } = await createInquiry({
          email: String(form['email'] ?? ''),
          name: form['name'] ? String(form['name']) : null,
          message: String(form['message'] ?? ''),
          productSlug: form['productSlug'] ? String(form['productSlug']) : null,
          ip,
        });
        // Answer immediately from verified product data; a reply email is sent
        // only if the owner has granted email permission, otherwise it is stored.
        await answerInquiry(id).catch((err) => logger.warn('inquiry auto-answer failed', { error: (err as Error).message }));
        const products = await listProducts(true);
        return sendHtml(
          res,
          200,
          contactHtml({ products: products.map((p) => ({ slug: p.slug, name: p.name })), notice: 'Thank you — your question has been received. We will reply to the email you gave us.' }),
        );
      } catch (err) {
        const products = await listProducts(true);
        return sendHtml(
          res,
          400,
          contactHtml({ products: products.map((p) => ({ slug: p.slug, name: p.name })), error: (err as Error).message }),
        );
      }
    }

    // Stripe webhook: public endpoint, raw body, signature-verified.
    // Money is recorded only here, and only after the signature checks out.
    if (req.method === 'POST' && url.pathname === '/webhooks/stripe') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks).toString('utf8');
      const sig = String(req.headers['stripe-signature'] ?? '');
      const result = await handleWebhook(raw, sig);
      return json(res, result.handled ? 200 : 400, result);
    }

    const match = routes.find((r) => r.method === req.method && r.path === url.pathname);
    if (!match) return json(res, 404, { error: 'not found' });

    let owner: OwnerIdentity | null = null;
    if (match.auth) {
      if (authBypass()) {
        owner = BYPASS_OWNER;
      } else {
        try {
          owner = await authenticate(bearer(req));
        } catch {
          return json(res, 401, { error: 'unauthorized' });
        }
      }
    }
    // M5: for a mutating request, re-check the session is still live immediately
    // before the handler runs, so a session revoked (or an emergency stop engaged)
    // mid-request cannot still land its write. This closes the window between the
    // auth check above and the mutation below.
    if (match.auth && req.method === 'POST' && !authBypass()) {
      try {
        await assertSessionLive(bearer(req));
      } catch {
        return json(res, 401, { error: 'unauthorized' });
      }
    }
    const body = req.method === 'POST' ? await readBody(req) : {};
    await match.handler(req, res, owner, body);
  } catch (err) {
    const { status, body } = statusForError(err);
    const msg = (err as Error)?.message ?? 'unknown';
    if (status >= 500) logger.error('api error', { error: msg });
    else logger.warn('api rejected', { error: msg, status });
    if (!res.headersSent) json(res, status, body);
  }
});

/**
 * Embedded worker.
 *
 * TAREQ's work happens in the durable task queue, which only moves when a worker
 * runs the orchestrator loop. When there is no separate worker service, the API
 * must host that loop itself, otherwise tasks enqueued by `/plan` and `/mission`
 * sit PENDING forever and nothing is ever autonomous.
 *
 * On by default so the agent always works. Set `TAREQ_EMBEDDED_WORKER=0` when a
 * dedicated worker service is running. Running both is safe anyway: tasks are
 * claimed atomically, so a second poller only adds redundancy.
 */
function embeddedWorkerEnabled(): boolean {
  const v = process.env.TAREQ_EMBEDDED_WORKER;
  if (v === '0' || v === 'false') return false;
  return true;
}

async function startEmbeddedWorker(): Promise<void> {
  try {
    const handlers = await bootstrapWorker();
    startScheduler();
    void run({ pollIntervalMs: 2_000 }).catch((err) =>
      logger.error('embedded worker stopped', { error: (err as Error).message }),
    );
    logger.info('embedded worker started', { handlers });
  } catch (err) {
    // A broken queue must not take the dashboard down; it stays observable.
    logger.error('embedded worker failed to start', { error: (err as Error).message });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  env();
  await resolveAuthBypass();
  server.listen(PORT, () => logger.info('tareq api listening', { port: PORT, authBypass: authBypass() }));
  if (embeddedWorkerEnabled()) void startEmbeddedWorker();
}

export { server, routes };
