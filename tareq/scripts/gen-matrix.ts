/**
 * Generates a source-only capability index snapshot.
 * Production evidence and per-capability blocker analysis live in
 * docs/PHASE1_100_CAPABILITY_REGISTER.md and are not fabricated here.
 * Regenerate with: node --experimental-strip-types scripts/gen-matrix.ts
 */
import { writeFileSync } from 'node:fs';
import { CAPABILITIES, summary } from '../src/lib/capabilities/index.ts';

const rows = CAPABILITIES.map((c) => {
  const deps = (c.dependsOn ?? []).join(', ') || '—';
  const evidence = (c.evidence ?? []).join('; ') || '—';
  return `| ${c.n} | ${c.name} | ${c.status} | \`${c.code ?? '—'}\` | ${deps} | ${evidence} |`;
});
const counts = summary();

const document = `# TAREQ AI — Source Capability Index Snapshot

Generated from \`src/lib/capabilities/index.ts\`. This file records source mappings and cited test references only; it is not production acceptance.

Use [the evidence-based register](PHASE1_100_CAPABILITY_REGISTER.md) for requirements, UI/API wiring, blockers and production evidence.

Total: ${CAPABILITIES.length}; unique IDs: ${new Set(CAPABILITIES.map((c) => c.n)).size}.

| Status | Count |
|---|---:|
${Object.entries(counts).map(([status, count]) => `| ${status} | ${count} |`).join('\n')}

| # | Capability | Source status | Code mapping | Declared dependencies | Cited test/live reference |
|---:|---|---|---|---|---|
${rows.join('\n')}
`;

writeFileSync(new URL('../docs/CAPABILITY_VERIFICATION_MATRIX.md', import.meta.url), document);
console.log(`wrote ${rows.length} source capability rows`);
