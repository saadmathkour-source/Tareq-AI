import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const html = readFileSync(new URL('../src/app/dashboard.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;

function dashboard(fetcher: typeof fetch, savedToken = '') {
  const elements = new Map<string, any>();
  const session = new Map(savedToken ? [['tareq.token', savedToken]] : []);
  const element = (id: string) => {
    if (!elements.has(id)) {
      const classes = new Set(['app', 'refreshBtn', 'stopBtn', 'logoutBtn'].includes(id) ? ['hidden'] : []);
      elements.set(id, {
        value: '', textContent: '', innerHTML: '', disabled: false,
        firstElementChild: { style: {} },
        classList: {
          add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name),
          contains: (name: string) => classes.has(name),
          toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name),
        },
      });
    }
    return elements.get(id);
  };
  const context = createContext({
    document: { documentElement: {}, getElementById: element, querySelectorAll: () => [] },
    sessionStorage: { getItem: (key: string) => session.get(key), setItem: (key: string, value: string) => session.set(key, value), removeItem: (key: string) => session.delete(key) },
    localStorage: { getItem: () => 'en', setItem: () => {} },
    fetch: fetcher, AbortSignal, confirm: () => false, alert: () => {},
  });
  runInContext(script, context);
  return { element, session, context, evaluate: (code: string) => runInContext(code, context) };
}

test('a transient data failure during session restore keeps the owner signed in', async () => {
  const ui = dashboard(async () => Response.json({error: 'internal error'}, {status: 500}), 'valid-session');
  await ui.evaluate('refreshPromise');
  assert.equal(ui.session.get('tareq.token'), 'valid-session');
  assert.equal(ui.element('app').classList.contains('hidden'), false);
  assert.equal(ui.element('login').classList.contains('hidden'), true);
  assert.match(ui.element('loadStatus').textContent, /session is retained/);
  assert.equal(ui.element('refreshBtn').disabled, false);
});

test('a rejected protected API session clears the token and displays sign-in', async () => {
  const ui = dashboard(async () => Response.json({error: 'unauthorized'}, {status: 401}), 'expired-session');
  await ui.evaluate('refreshPromise');
  assert.equal(ui.session.has('tareq.token'), false);
  assert.equal(ui.element('app').classList.contains('hidden'), true);
  assert.equal(ui.element('login').classList.contains('hidden'), false);
  assert.match(ui.element('loginErr').textContent, /expired/);
  assert.equal(ui.element('stopBtn').classList.contains('hidden'), true);
});

test('native form submission logs in once, clears the password and survives a data error', async () => {
  let logins = 0;
  const ui = dashboard(async (url) => {
    if (String(url) === '/auth/login') { logins++; return Response.json({token: 'new-session'}); }
    return Response.json({error: 'internal error'}, {status: 503});
  });
  ui.element('email').value = 'owner@example.test';
  ui.element('password').value = 'local-only-password';
  let prevented = false;
  const event = {preventDefault() { prevented = true; }};
  const pending = ui.element('loginForm').onsubmit(event);
  await ui.element('loginForm').onsubmit(event);
  await pending;
  assert.equal(prevented, true);
  assert.equal(logins, 1);
  assert.equal(ui.session.get('tareq.token'), 'new-session');
  assert.equal(ui.element('password').value, '');
  assert.equal(ui.element('loginErr').textContent, '');
});

test('refresh requests are bounded and overlapping refresh clicks are coalesced', async () => {
  let active = 0, maximum = 0, calls = 0;
  const ui = dashboard(async (url) => {
    calls++; active++; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    if (String(url) === '/integrations') return Response.json({
      commercialVerification: {finishedAt: '2026-11-10T21:23:23Z', result: {email: {connectionVerified: false}}},
    });
    return Response.json({});
  }, 'valid-session');
  const pending = ui.evaluate('refreshPromise');
  assert.equal(ui.evaluate('refresh()'), pending);
  assert.equal(await pending, true);
  assert.equal(maximum, 2);
  assert.equal(calls, 22);
  assert.match(ui.element('integrations').innerHTML, /Email connection: failed/);
  assert.match(ui.element('integrations').innerHTML, /Email delivery: unverified/);
});

test('logout while loading does not render the arriving owner data', async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const ui = dashboard(async () => { await blocked; return Response.json({}); }, 'valid-session');
  const pending = ui.evaluate('refreshPromise');
  ui.evaluate('clearSession()');
  release();
  assert.equal(await pending, false);
  assert.equal(ui.element('exec').innerHTML, '');
  assert.equal(ui.element('app').classList.contains('hidden'), true);
});
