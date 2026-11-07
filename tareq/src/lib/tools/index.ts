import { z } from 'zod';
import { registerTool, listTools, type ToolDefinition } from './registry.ts';
import { researchSource, researchDemand } from './research.ts';

/**
 * Tool registration (capability 6).
 *
 * The registry is the single gate through which the agent affects the world.
 * Tools are registered once at worker start-up. Without this wiring the registry
 * was empty, so every action bypassed the schema-validation and audit path that
 * the registry provides.
 */

const fetchSource: ToolDefinition<{ url: string; statement: string; validForDays?: number }> = {
  name: 'research.fetch_source',
  description: 'Fetch a public URL and record it as an unpublished evidence claim.',
  actionClass: 'research.search',
  untrustedOutput: true,
  schema: z.object({
    url: z.string().url(),
    statement: z.string().min(8).max(500),
    validForDays: z.number().int().positive().max(365).optional(),
  }),
  run: async (input) => researchSource(input.url, input.statement, input.validForDays),
};

const demandScan: ToolDefinition<{ topic: string; limit?: number }> = {
  name: 'research.demand_scan',
  description: 'Scan public discussion signals for a topic (keyless, no paid search).',
  actionClass: 'research.search',
  untrustedOutput: true,
  schema: z.object({ topic: z.string().min(2).max(200), limit: z.number().int().min(1).max(50).optional() }),
  run: async (input) => researchDemand(input.topic, { limit: input.limit }),
};

let wired = false;

/** Register the built-in tools. Idempotent so tests and restarts are safe. */
export function registerBuiltinTools(): void {
  if (wired) return;
  registerTool(fetchSource);
  registerTool(demandScan);
  wired = true;
}

export { listTools };
