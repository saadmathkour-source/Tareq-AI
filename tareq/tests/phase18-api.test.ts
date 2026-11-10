import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { server, resolveAuthBypass } from '../src/app/server.ts';
import { prisma } from '../src/lib/core/db.ts';
import { getControls, setControls } from '../src/lib/security/controls.ts';

/**
 * HTTP-level integration tests for the Phase 18 endpoints. These drive the REAL
 * server routes over a real socket (not string matching, not direct function
 * calls), so they prove the auth gate, the server-side control enforcement and
 * the status codes actually behave. They run against the isolated test database
 * (`TAREQ_USE_TEST_DB=1`).
 *
 * Auth strategy: the owner-auth bypass is used with a stubbed owner count of 0,
 * which is exactly the lockout-recovery path the bypass is designed for. That
 * lets these tests exercise authenticated routing without creating an owner row.
 */

const MARK = `IT18-${randomUUID().slice(0, 8)}`;

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const prevBypass = process.env.TAREQ_AUTH_BYPASS;
  process.env.TAREQ_AUTH_BYPASS = '1';
  await resolveAuthBypass(async () => 0); // no owner => bypass is allowed
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    if (prevBypass === undefined) delete process.env.TAREQ_AUTH_BYPASS;
    else process.env.TAREQ_AUTH_BYPASS = prevBypass;
  }
}

async function withNoAuth<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const prevBypass = process.env.TAREQ_AUTH_BYPASS;
  delete process.env.TAREQ_AUTH_BYPASS;
  await resolveAuthBypass(async () => 1); // an owner exists => normal auth, no bypass
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    if (prevBypass === undefined) delete process.env.TAREQ_AUTH_BYPASS;
    else process.env.TAREQ_AUTH_BYPASS = prevBypass;
  }
}

const post = (base: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

// --- authentication is enforced on every new endpoint -----------------------
test('every new endpoint rejects an unauthenticated request with 401', async () => {
  await withNoAuth(async (base) => {
    const cases: Array<[string, string]> = [
      ['GET', '/controls'],
      ['POST', '/controls'],
      ['GET', '/supervisor'],
      ['POST', '/supervisor/run'],
      ['POST', '/supervisor/resolve'],
      ['GET', '/optimization'],
      ['GET', '/readiness'],
      ['POST', '/resume'],
      ['POST', '/products/seed'],
      ['POST', '/products/publish'],
    ];
    for (const [method, path] of cases) {
      const res = method === 'GET' ? await fetch(`${base}${path}`) : await post(base, path);
      assert.equal(res.status, 401, `${method} ${path} must require auth`);
    }
  });
});

// --- GET /controls ----------------------------------------------------------
test('GET /controls returns controls, usage and the implementation status', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/controls`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { controls: Record<string, unknown>; usage: Record<string, unknown>; status: { implemented: string[]; notImplemented: string[] } };
    assert.equal(typeof body.controls.dailyBudgetUsd, 'number');
    assert.equal(typeof body.controls.publishingAllowed, 'boolean');
    assert.ok(Array.isArray(body.status.implemented) && Array.isArray(body.status.notImplemented));
    assert.ok(body.status.notImplemented.includes('marketingAllowed'), 'unimplemented controls are reported');
    assert.ok(body.status.implemented.includes('publishingAllowed'));
  });
});

// --- POST /controls ---------------------------------------------------------
test('POST /controls rejects a negative numeric value with 400', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/controls', { dailyBudgetUsd: -5 });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /non-negative/);
  });
});

test('POST /controls refuses to enable a NOT IMPLEMENTED control (fail closed)', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/controls', { marketingAllowed: true });
    assert.equal(res.status, 400, 'an unenforced control cannot be turned on');
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /NOT IMPLEMENTED/);
    const read = (await (await fetch(`${base}/controls`)).json()) as { controls: { marketingAllowed: boolean } };
    assert.equal(read.controls.marketingAllowed, false, 'the control stays off');
  });
});

test('POST /controls accepts a valid change and persists it', async () => {
  await withServer(async (base) => {
    const original = await getControls();
    try {
      const res = await post(base, '/controls', { dailyBudgetUsd: 3.25 });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { controls: { dailyBudgetUsd: number } };
      assert.equal(body.controls.dailyBudgetUsd, 3.25);
    } finally {
      await setControls({ dailyBudgetUsd: original.dailyBudgetUsd }, 'test');
    }
  });
});

// --- supervisor -------------------------------------------------------------
test('GET /supervisor returns findings and a byStatus summary', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/supervisor`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { findings: unknown[]; byStatus: Record<string, number> };
    assert.ok(Array.isArray(body.findings));
    assert.equal(typeof body.byStatus, 'object');
  });
});

test('POST /supervisor/run executes the watchdog and reports counts', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/supervisor/run');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; findings: unknown[]; autoResolved: number; requiresHuman: number };
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.findings));
    assert.equal(typeof body.autoResolved, 'number');
    assert.equal(typeof body.requiresHuman, 'number');
  });
});

test('POST /supervisor/resolve with an unknown id returns 404', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/supervisor/resolve', { id: randomUUID() });
    assert.equal(res.status, 404);
  });
});

test('POST /supervisor/resolve without an id returns 400', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/supervisor/resolve', {});
    assert.equal(res.status, 400);
  });
});

// --- optimization / readiness ----------------------------------------------
test('GET /optimization returns a product verdict report', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/optimization`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { products: unknown[]; actions: string[]; requiresOwnerApproval: string[] };
    assert.ok(Array.isArray(body.products));
    assert.ok(Array.isArray(body.actions));
    assert.ok(Array.isArray(body.requiresOwnerApproval));
  });
});

test('GET /readiness returns the honest readiness checklist', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/readiness`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { items: unknown[]; verified: number; total: number; complete: boolean };
    assert.ok(Array.isArray(body.items));
    assert.equal(typeof body.total, 'number');
    assert.equal(typeof body.complete, 'boolean');
  });
});

// --- emergency stop / resume ------------------------------------------------
test('POST /resume clears the emergency stop', async () => {
  await withServer(async (base) => {
    const original = await getControls();
    try {
      await setControls({ emergencyStop: true }, 'test');
      const res = await post(base, '/resume');
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean; emergencyStop: boolean };
      assert.equal(body.emergencyStop, false);
    } finally {
      await setControls({ emergencyStop: original.emergencyStop }, 'test');
    }
  });
});

// --- products/seed & products/publish --------------------------------------
test('POST /products/seed creates products as DRAFT and publishes nothing', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/products/seed');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; count: number };
    assert.equal(body.ok, true);
    assert.ok(body.count >= 1);
  });
});

test('POST /products/publish rejects a missing slug (400) and an unknown product (404)', async () => {
  await withServer(async (base) => {
    const noSlug = await post(base, '/products/publish', {});
    assert.equal(noSlug.status, 400);

    const unknown = await post(base, '/products/publish', { slug: `${MARK}-nope` });
    assert.equal(unknown.status, 404);

    const badStatus = await post(base, '/products/publish', { slug: 'x', status: 'BOGUS' });
    assert.equal(badStatus.status, 400);
  });
});

test('POST /products/publish is refused when publishingAllowed is off', async () => {
  await withServer(async (base) => {
    const original = await getControls();
    const slug = `${MARK}-pub`;
    await prisma.product.create({
      data: {
        slug, name: 'Pub Test', tagline: 't', problem: 'p', solution: 's',
        deliverables: [] as never, deliverySteps: [] as never, requirements: [] as never,
        limitations: [] as never, qaChecklist: [] as never, priceUsd: 10, costUsd: 1, marginPct: 90,
        status: 'DRAFT', claimRefs: [] as never,
      },
    });
    try {
      await setControls({ publishingAllowed: false, emergencyStop: false }, 'test');
      const res = await post(base, '/products/publish', { slug, status: 'PUBLISHED' });
      assert.equal(res.status, 401, 'the owner control blocks publishing');
      const row = await prisma.product.findUniqueOrThrow({ where: { slug } });
      assert.equal(row.status, 'DRAFT', 'the product stays DRAFT');
    } finally {
      await setControls({ publishingAllowed: original.publishingAllowed }, 'test');
      await prisma.product.deleteMany({ where: { slug } });
    }
  });
});

test('POST /products/publish succeeds only when the control is on (owner-authorised)', async () => {
  await withServer(async (base) => {
    const original = await getControls();
    const slug = `${MARK}-pub2`;
    await prisma.product.create({
      data: {
        slug, name: 'Pub Test 2', tagline: 't', problem: 'p', solution: 's',
        deliverables: [] as never, deliverySteps: [] as never, requirements: [] as never,
        limitations: [] as never, qaChecklist: [] as never, priceUsd: 10, costUsd: 1, marginPct: 90,
        status: 'DRAFT', claimRefs: [] as never,
      },
    });
    try {
      await setControls({ publishingAllowed: true, emergencyStop: false }, 'test');
      const res = await post(base, '/products/publish', { slug, status: 'PUBLISHED' });
      assert.equal(res.status, 200, 'an authorised publish succeeds');
      const row = await prisma.product.findUniqueOrThrow({ where: { slug } });
      assert.equal(row.status, 'PUBLISHED');
    } finally {
      await setControls({ publishingAllowed: original.publishingAllowed }, 'test');
      await prisma.product.deleteMany({ where: { slug } });
    }
  });
});
