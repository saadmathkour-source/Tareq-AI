/**
 * Structured logger with secret redaction.
 *
 * Every log line passes through `redact()` first. Secrets and known-sensitive
 * keys are replaced before anything is written, so a stray log call cannot leak
 * an API key or the owner's session token.
 */

const SECRET_ENV_NAMES = [
  'DATABASE_URL',
  'DIRECT_URL',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TAREQ_OWNER_PASSWORD',
  'TAREQ_SESSION_SECRET',
  'SUPABASE_ACCESS_TOKEN',
  'GITHUB_TOKEN',
  'TELEGRAM_BOT_TOKEN',
  'OPENHANDS_API_KEY',
];

const SENSITIVE_KEY_PATTERN = /(pass(word)?|secret|token|api[_-]?key|authorization|cookie|session)/i;

function secretValues(): string[] {
  const out: string[] = [];
  for (const name of SECRET_ENV_NAMES) {
    const v = process.env[name];
    if (v && v.length >= 8) out.push(v);
  }
  return out;
}

export function redact(input: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (typeof input === 'string') {
    let s = input;
    for (const secret of secretValues()) {
      if (s.includes(secret)) s = s.split(secret).join('[REDACTED]');
    }
    // Redact credential-bearing URLs (postgres://user:pass@host)
    s = s.replace(/(\w+:\/\/[^:@\s]+):[^@\s]+@/g, '$1:[REDACTED]@');
    // Redact common token shapes
    s = s.replace(/\b(gh[pousr]_[A-Za-z0-9]{10,})\b/g, '[REDACTED]');
    s = s.replace(/\b(sk-[A-Za-z0-9_-]{10,})\b/g, '[REDACTED]');
    s = s.replace(/\b(whsec_[A-Za-z0-9]{10,})\b/g, '[REDACTED]');
    return s;
  }
  if (Array.isArray(input)) return input.map((v) => redact(v, depth + 1));
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_PATTERN.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return input;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL: Level = (process.env.TAREQ_LOG_LEVEL as Level) || 'info';

function emit(level: Level, message: string, fields?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg: redact(message),
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  };
  const text = JSON.stringify(line);
  if (level === 'error') process.stderr.write(text + '\n');
  else process.stdout.write(text + '\n');
}

export const logger = {
  debug: (m: string, f?: Record<string, unknown>) => emit('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => emit('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => emit('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => emit('error', m, f),
  child: (base: Record<string, unknown>) => ({
    debug: (m: string, f?: Record<string, unknown>) => emit('debug', m, { ...base, ...f }),
    info: (m: string, f?: Record<string, unknown>) => emit('info', m, { ...base, ...f }),
    warn: (m: string, f?: Record<string, unknown>) => emit('warn', m, { ...base, ...f }),
    error: (m: string, f?: Record<string, unknown>) => emit('error', m, { ...base, ...f }),
  }),
};
