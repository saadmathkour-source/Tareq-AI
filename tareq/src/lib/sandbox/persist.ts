import { prisma } from '../core/db.ts';
import type { SandboxRun } from './exec.ts';

/**
 * Persist a sandbox run as a reusable asset so its output survives the process
 * and can be mined later (capability 56, Reusable Asset Miner). Failed runs are
 * stored too, with the error in `notes`, so a failed experiment is evidence.
 */
export async function persistArtifact(name: string, run: SandboxRun, notes = ''): Promise<string> {
  const ref = run.ok ? JSON.stringify(run.output ?? null).slice(0, 2000) : null;
  const suffix = run.ok ? '' : ` | error: ${run.error ?? 'unknown'}`;
  const row = await prisma.asset.create({
    data: { kind: 'sandbox_artifact', name, ref, notes: `${notes}${suffix}`.trim(), costUsd: 0 },
  });
  return row.id;
}
