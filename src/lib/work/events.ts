import { asc, eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { campEvents } from '@/db/schema/camp';
import type { EventKind } from '@/db/schema/camp';

export type CampEvent = typeof campEvents.$inferSelect;

export interface NewEvent {
  seasonId: string;
  name: string;
  kind: EventKind;
  heldOn?: Date;
}

export async function createEvent(db: AnyDb, input: NewEvent): Promise<CampEvent> {
  const [event] = await db.insert(campEvents).values({
    seasonId: input.seasonId,
    name: input.name,
    kind: input.kind,
    heldOn: input.heldOn ?? null,
  }).returning();
  return event;
}

export async function listEvents(db: AnyDb, seasonId: string): Promise<CampEvent[]> {
  return db.select().from(campEvents)
    .where(eq(campEvents.seasonId, seasonId))
    .orderBy(asc(campEvents.heldOn), asc(campEvents.name));
}
