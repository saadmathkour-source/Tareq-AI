import { prisma } from './db.ts';
import { logger } from './logger.ts';

/**
 * Durable event bus built on the `events` table (transactional outbox).
 *
 * Producers append events in the same transaction as their state change; the
 * worker drains them. This means an event is never lost if the process dies
 * between "state changed" and "handler ran".
 */

export interface TareqEvent<T = Record<string, unknown>> {
  id: string;
  type: string;
  payload: T;
  createdAt: Date;
}

export type EventHandler<T = Record<string, unknown>> = (event: TareqEvent<T>) => Promise<void>;

const handlers = new Map<string, EventHandler[]>();

/** Register a handler for an event type. `*` subscribes to everything. */
export function on<T = Record<string, unknown>>(type: string, handler: EventHandler<T>): void {
  const list = handlers.get(type) ?? [];
  list.push(handler as EventHandler);
  handlers.set(type, list);
}

export async function emit(
  type: string,
  payload: Record<string, unknown> = {},
  tx?: { event: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> } },
): Promise<string> {
  const data = { type, payload: payload as never };
  if (tx) {
    const row = (await tx.event.create({ data })) as { id: string };
    return row.id;
  }
  const row = await prisma.event.create({ data });
  return row.id;
}

/**
 * Drain unprocessed events. Called by the worker on each tick.
 * Handlers run in registration order; a throwing handler marks the event with
 * its error but does not block the rest.
 */
export async function drain(limit = 50): Promise<number> {
  const pending = await prisma.event.findMany({
    where: { processedAt: null },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  let handled = 0;
  for (const ev of pending) {
    const typeHandlers = [...(handlers.get(ev.type) ?? []), ...(handlers.get('*') ?? [])];
    let error: string | null = null;
    for (const h of typeHandlers) {
      try {
        await h({ id: ev.id, type: ev.type, payload: ev.payload as Record<string, unknown>, createdAt: ev.createdAt });
      } catch (err) {
        error = (err as Error).message;
        logger.error('event handler failed', { eventId: ev.id, type: ev.type, error });
      }
    }
    await prisma.event.update({
      where: { id: ev.id },
      data: { processedAt: new Date(), error },
    });
    handled++;
  }
  return handled;
}

/** Test helper — clears in-process subscriptions. */
export function resetHandlers(): void {
  handlers.clear();
}
