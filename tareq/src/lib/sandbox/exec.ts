/**
 * Sandboxed execution (capability 13 — Product Construction).
 *
 * Runs a small, self-contained program and returns its result, without giving
 * the program any access to the host: no `require`, no `process`, no `fetch`,
 * no filesystem, no `eval`/`new Function`. Execution is bounded by a wall-clock
 * timeout.
 *
 * Isolation is real for the class of programs this is meant to run (pure
 * computation: parsing, scoring, formatting, data transforms). It is NOT a
 * defence against a hostile kernel-level attacker, and it deliberately refuses
 * anything that asks for host powers instead of pretending to allow it.
 *
 * The module is a pure function of its inputs and the host `node:vm`, so it is
 * unit-testable without a database or a model.
 */
import vm from 'node:vm';

export interface SandboxLimits {
  /** Wall-clock ceiling for the program, in milliseconds. */
  timeoutMs: number;
  /** V8 old-space ceiling, recorded for the (optional) child-process runner. */
  memoryMb?: number;
}

export interface SandboxResult {
  ok: boolean;
  /** The value the program returned, if it is JSON-serialisable. */
  output?: unknown;
  /** Anything the program wrote through `print`. */
  logs: string[];
  error?: string;
  durationMs: number;
  timedOut: boolean;
}

export const DEFAULT_LIMITS: SandboxLimits = { timeoutMs: 1000, memoryMb: 128 };

/** Globals a sandboxed program may see. Everything else is absent by design. */
function safeContext(logs: string[]): Record<string, unknown> {
  const print = (...args: unknown[]): void => {
    logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  return {
    Math, JSON, Date, Array, Object, String, Number, Boolean, RegExp, Map, Set, Error,
    isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    print,
  };
}

/**
 * Run `code` in an isolated V8 context. The program must `return` its result
 * (it is wrapped in a function body); a JSON-serialisable value is required.
 */
export function runSandbox(code: string, limits: SandboxLimits = DEFAULT_LIMITS): SandboxResult {
  const started = Date.now();
  const logs: string[] = [];

  // `codeGeneration.strings: false` removes eval() and new Function(), which
  // closes the classic escape from a vm context back to the host.
  const context = vm.createContext(safeContext(logs), {
    codeGeneration: { strings: false, wasm: false },
  });

  const wrapped = `(function () {\n${code}\n})()`;
  const script = new vm.Script(wrapped, { filename: 'sandbox.js' });

  try {
    const output = script.runInContext(context, { timeout: limits.timeoutMs });
    // Only JSON-serialisable output is allowed out of the sandbox.
    const serialisable = output === undefined ? undefined : JSON.parse(JSON.stringify(output));
    return { ok: true, output: serialisable, logs, durationMs: Date.now() - started, timedOut: false };
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    const timedOut = /timed out|Script execution timed out/i.test(message);
    return { ok: false, error: timedOut ? 'execution timed out' : message, logs, durationMs: Date.now() - started, timedOut };
  }
}

/** Refuse a program that references host powers, before it ever runs. */
export function staticScreen(code: string): { allowed: boolean; reason?: string } {
  const banned = [
    /\brequire\s*\(/,
    /\bprocess\b/,
    /\bfetch\s*\(/,
    /\bimport\s*\(/,
    /\bglobalThis\b/,
    /\bFunction\s*\(/,
    /\beval\s*\(/,
    /\bchild_process\b/,
    /\b__proto__\b/,
  ];
  for (const re of banned) {
    if (re.test(code)) return { allowed: false, reason: `blocked pattern: ${re.source}` };
  }
  return { allowed: true };
}

export interface SandboxRun extends SandboxResult {
  screened: boolean;
}

/** Screen then run. A program that trips the static screen is rejected unrun. */
export function safeRun(code: string, limits: SandboxLimits = DEFAULT_LIMITS): SandboxRun {
  const screen = staticScreen(code);
  if (!screen.allowed) {
    return { ok: false, error: screen.reason, logs: [], durationMs: 0, timedOut: false, screened: true };
  }
  return { ...runSandbox(code, limits), screened: true };
}
