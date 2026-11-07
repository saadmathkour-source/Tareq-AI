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
import { authenticate, login, logout, revokeAllSessions, type OwnerIdentity } from '../lib/security/owner-auth.ts';
import { currentMode, setMode, type OperatingMode } from '../lib/security/permissions.ts';
import { health, capabilityTable } from '../lib/observability/health.ts';
import { stats as queueStats, cancel } from '../lib/queue/tasks.ts';
import { summary as financeSummary, acquisitionMetrics } from '../lib/finance/ledger.ts';
import { snapshot as budgetSnapshot } from '../lib/security/budget.ts';
import { prisma } from '../lib/core/db.ts';
import { verifyChain } from '../lib/core/audit.ts';
import { audit } from '../lib/core/audit.ts';
import { plan, planFromCommand } from '../lib/planner/index.ts';
import { runMission } from '../lib/commercial/mission.ts';
import { status as gmailStatus } from '../lib/integrations/gmail.ts';
import { status as hubspotStatus } from '../lib/integrations/hubspot.ts';
import { status as stripeStatus, handleWebhook } from '../lib/integrations/stripe.ts';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = Number(process.env.PORT ?? 3300);

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

route('POST', '/auth/login', false, async (_req, res, _o, body) => {
  const email = String(body['email'] ?? '');
  const password = String(body['password'] ?? '');
  const { token, owner } = await login(email, password);
  json(res, 200, { token, owner });
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
  // Drop to the safest mode, cancel queued work and revoke sessions.
  await setMode('OBSERVE', owner!.id);
  const cancelled = await prisma.task.updateMany({
    where: { status: { in: ['PENDING', 'QUEUED', 'RETRYING'] } },
    data: { status: 'CANCELLED', error: 'emergency stop', finishedAt: new Date() },
  });
  await revokeAllSessions(owner!.id);
  await audit({ actorType: 'owner', actorId: owner!.id, action: 'emergency_stop', severity: 'critical', metadata: { cancelled: cancelled.count } });
  json(res, 200, { ok: true, mode: 'OBSERVE', cancelled: cancelled.count });
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

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    // Owner dashboard (static shell; data comes from authenticated API calls).
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) {
      const html = dashboard();
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html) });
      res.end(html);
      return;
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
      try {
        owner = await authenticate(bearer(req));
      } catch {
        return json(res, 401, { error: 'unauthorized' });
      }
    }
    const body = req.method === 'POST' ? await readBody(req) : {};
    await match.handler(req, res, owner, body);
  } catch (err) {
    logger.error('api error', { error: (err as Error).message });
    if (!res.headersSent) json(res, 500, { error: 'internal error' });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  env();
  server.listen(PORT, () => logger.info('tareq api listening', { port: PORT }));
}

export { server, routes };
