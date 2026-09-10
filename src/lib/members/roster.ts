import { and, asc, desc, eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { persons, seasons, memberships } from '@/db/schema/camp';
import { fromAgorot, toAgorot } from '@/lib/money';

export type Season = typeof seasons.$inferSelect;

export interface RosterEntry {
  personId: string;
  displayName: string;
  role: string;
  joinedAt: Date;
}

export interface NewSeason {
  name: string;
  year: number;
  /** In shekels, e.g. 1500. Stored as numeric(12,2). */
  flatRate: number;
  plannedSize?: number;
  startsOn?: Date;
}

export async function createSeason(db: AnyDb, input: NewSeason): Promise<Season> {
  const [season] = await db.insert(seasons).values({
    name: input.name,
    year: input.year,
    flatRate: fromAgorot(toAgorot(input.flatRate)),
    plannedSize: input.plannedSize ?? null,
    startsOn: input.startsOn ?? null,
  }).returning();
  return season;
}

export async function listSeasons(db: AnyDb): Promise<Season[]> {
  return db.select().from(seasons).orderBy(desc(seasons.year), desc(seasons.name));
}

export async function getSeasonByName(db: AnyDb, name: string): Promise<Season | undefined> {
  const [season] = await db.select().from(seasons).where(eq(seasons.name, name));
  return season;
}

/** Idempotent: re-adding an existing member updates their role. */
export async function addMember(
  db: AnyDb, personId: string, seasonId: string, role: string = 'member',
): Promise<void> {
  await db.insert(memberships)
    .values({ personId, seasonId, role })
    .onConflictDoUpdate({
      target: [memberships.personId, memberships.seasonId],
      set: { role },
    });
}

export async function listRoster(db: AnyDb, seasonId: string): Promise<RosterEntry[]> {
  const rows = await db
    .select({
      personId: persons.id,
      displayName: persons.displayName,
      role: memberships.role,
      joinedAt: memberships.joinedAt,
    })
    .from(memberships)
    .innerJoin(persons, eq(persons.id, memberships.personId))
    .where(eq(memberships.seasonId, seasonId))
    .orderBy(asc(persons.displayName));
  return rows;
}

export async function removeMember(
  db: AnyDb, personId: string, seasonId: string,
): Promise<void> {
  await db.delete(memberships).where(
    and(eq(memberships.personId, personId), eq(memberships.seasonId, seasonId)),
  );
}
