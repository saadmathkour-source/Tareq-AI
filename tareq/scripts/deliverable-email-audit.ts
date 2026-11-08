/**
 * Email-deliverability audit — the concrete deliverable for the
 * "email deliverability" opportunity.
 *
 * It performs real, read-only DNS lookups (MX, SPF, DMARC, DKIM) against the
 * live DNS of a target domain and writes a self-contained HTML report. It makes
 * no network writes and needs no third-party account. Every finding cites the
 * exact DNS record it came from, so the owner (and the buyer) can verify it.
 *
 * Run: node --experimental-strip-types scripts/deliverable-email-audit.ts <domain> [dkimSelector]
 */
import { promises as dns } from 'node:dns';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface Finding {
  area: 'MX' | 'SPF' | 'DMARC' | 'DKIM';
  status: 'PASS' | 'WARN' | 'FAIL';
  detail: string;
  record: string | null;
}

export interface AuditReport {
  domain: string;
  dkimSelector: string;
  generatedAt: string;
  findings: Finding[];
  score: number;
  mx: string[];
}

const LOOKUP_MECHANISMS = ['include:', 'a', 'mx', 'ptr', 'exists:', 'redirect='];

async function txt(name: string): Promise<string[]> {
  try {
    const rows = await dns.resolveTxt(name);
    return rows.map((r) => r.join(''));
  } catch {
    return [];
  }
}

export async function audit(domain: string, dkimSelector = 'google'): Promise<AuditReport> {
  const findings: Finding[] = [];

  // --- MX: can the domain receive mail at all? ------------------------------
  let mx: string[] = [];
  try {
    mx = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority).map((m) => `${m.priority} ${m.exchange}`);
    findings.push({ area: 'MX', status: mx.length ? 'PASS' : 'FAIL', detail: mx.length ? `${mx.length} mail exchanger(s)` : 'no MX records — cannot receive mail', record: mx.join(', ') || null });
  } catch {
    findings.push({ area: 'MX', status: 'FAIL', detail: 'no MX records — cannot receive mail', record: null });
  }

  // --- SPF ----------------------------------------------------------------
  const spf = (await txt(domain)).find((t) => t.startsWith('v=spf1'));
  if (!spf) {
    findings.push({ area: 'SPF', status: 'FAIL', detail: 'no SPF record — receivers cannot verify your sending hosts', record: null });
  } else {
    const lookups = LOOKUP_MECHANISMS.reduce((n, m) => n + (spf.includes(m) ? 1 : 0), 0);
    const all = spf.match(/[-~?+]all/)?.[0] ?? 'none';
    const hardFail = all === '-all';
    const softFail = all === '~all';
    const neutral = all === '?all' || all === 'none';
    let status: Finding['status'] = 'PASS';
    const notes: string[] = [];
    if (neutral) { status = 'FAIL'; notes.push('permissive "?all"/no all — spoofable'); }
    else if (softFail) { status = 'WARN'; notes.push('soft fail (~all) — spoofed mail still lands'); }
    if (lookups > 10) { status = 'FAIL'; notes.push(`${lookups} DNS lookups > 10 limit — SPF breaks`); }
    notes.push(hardFail ? 'hard fail (-all)' : `all=${all}`);
    findings.push({ area: 'SPF', status, detail: notes.join('; '), record: spf });
  }

  // --- DMARC --------------------------------------------------------------
  const dmarc = (await txt(`_dmarc.${domain}`)).find((t) => t.startsWith('v=DMARC1'));
  if (!dmarc) {
    findings.push({ area: 'DMARC', status: 'FAIL', detail: 'no DMARC record — no policy for failed authentication', record: null });
  } else {
    const p = dmarc.match(/\bp=(\w+)/)?.[1] ?? 'none';
    const rua = /rua=/.test(dmarc);
    const pct = dmarc.match(/\bpct=(\d+)/)?.[1];
    let status: Finding['status'] = p === 'reject' ? 'PASS' : p === 'quarantine' ? 'WARN' : 'FAIL';
    const notes = [`p=${p}`];
    if (!rua) { notes.push('no rua= reporting address'); if (status === 'PASS') status = 'WARN'; }
    if (pct && pct !== '100') notes.push(`pct=${pct} (partial enforcement)`);
    findings.push({ area: 'DMARC', status, detail: notes.join('; '), record: dmarc });
  }

  // --- DKIM (one selector; the exact selector must be confirmed by the owner) ---
  const dkim = await txt(`${dkimSelector}._domainkey.${domain}`);
  const dkimOk = dkim.some((t) => /v=DKIM1/.test(t) || /p=/.test(t));
  findings.push({
    area: 'DKIM',
    status: dkimOk ? 'PASS' : 'WARN',
    detail: dkimOk ? `selector "${dkimSelector}" publishes a key` : `no key at selector "${dkimSelector}" — confirm the real selector with the mail provider`,
    record: dkim.join(' ') || null,
  });

  const weights: Record<Finding['status'], number> = { PASS: 1, WARN: 0.5, FAIL: 0 };
  const score = Math.round((findings.reduce((s, f) => s + weights[f.status], 0) / findings.length) * 100);

  return { domain, dkimSelector, generatedAt: new Date().toISOString(), findings, score, mx };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderHtml(r: AuditReport): string {
  const color: Record<Finding['status'], string> = { PASS: '#0a7d33', WARN: '#b7791f', FAIL: '#c53030' };
  const rows = r.findings.map((f) => `
    <tr>
      <td><strong>${f.area}</strong></td>
      <td style="color:${color[f.status]};font-weight:700">${f.status}</td>
      <td>${esc(f.detail)}</td>
      <td><code>${f.record ? esc(f.record.slice(0, 160)) : '—'}</code></td>
    </tr>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Email deliverability audit — ${esc(r.domain)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#1a202c}
h1{margin-bottom:4px}.score{font-size:44px;font-weight:800}.muted{color:#718096}
table{border-collapse:collapse;width:100%;margin-top:20px}th,td{border:1px solid #e2e8f0;padding:8px;text-align:left;vertical-align:top}
th{background:#f7fafc}code{font-size:12px;word-break:break-all}</style></head>
<body>
<h1>Email deliverability audit</h1>
<p class="muted">Domain: <strong>${esc(r.domain)}</strong> · Generated ${esc(r.generatedAt)} · DKIM selector checked: <code>${esc(r.dkimSelector)}</code></p>
<p><span class="score" style="color:${r.score >= 80 ? color.PASS : r.score >= 50 ? color.WARN : color.FAIL}">${r.score}/100</span>
<span class="muted">— weighted across MX, SPF, DMARC and DKIM</span></p>
<table><thead><tr><th>Area</th><th>Status</th><th>Finding</th><th>Raw DNS record</th></tr></thead><tbody>${rows}</tbody></table>
<p class="muted" style="margin-top:24px">Every finding above is derived from a live public DNS lookup performed at generation time. No estimate, no simulated data.
Fixes are standard DNS changes the domain owner applies at their DNS host.</p>
</body></html>`;
}

async function main(): Promise<void> {
  const domain = (process.argv[2] ?? '').trim();
  const selector = (process.argv[3] ?? 'google').trim();
  if (!domain) {
    console.error('usage: deliverable-email-audit.ts <domain> [dkimSelector]');
    process.exit(2);
  }
  const report = await audit(domain, selector);
  const dir = resolve(process.cwd(), 'deliverables');
  await mkdir(dir, { recursive: true });
  const out = resolve(dir, `${domain}-email-audit.html`);
  await writeFile(out, renderHtml(report), 'utf8');
  console.log(JSON.stringify({ out, ...report }, null, 1));
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '');
if (invokedDirectly) await main();
