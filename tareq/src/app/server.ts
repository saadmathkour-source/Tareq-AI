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
import { plan } from '../lib/planner/index.ts';

const PORT = Number(process.env.PORT ?? 3300);

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
  json(res, 200, { summary, budget, acquisition: acq });
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
  try {
    const ids = await plan(goal, opportunityId);
    json(res, 200, { ok: true, tasks: ids });
  } catch (err) {
    json(res, 400, { error: (err as Error).message });
  }
});

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
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
