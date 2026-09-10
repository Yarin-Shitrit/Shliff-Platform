import { eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { seasons, memberships, dues, payments, persons } from '@/db/schema/camp';
import { toAgorot } from '@/lib/money';

/**
 * The per-season totals a camp lead opens the site to see — the numbers that
 * used to be typed by hand into a cell like `סה״כ 43 → 60,955`. Every field
 * here is derived from `dues` and `payments` rows; none of it is stored.
 */
export interface SeasonFeeSummary {
  seasonId: string;
  seasonName: string;
  flatRateAgorot: number;
  memberCount: number;
  flatCount: number;
  exceptionCount: number;
  expectedAgorot: number;
  collectedAgorot: number;
  outstandingAgorot: number;
  /** Dues with at least one agora still owing. */
  unpaidCount: number;
  /** Roster members with no due row at all — surfaced, never silently skipped. */
  missingDues: string[];
}

export async function seasonFeeSummary(
  db: AnyDb, seasonId: string,
): Promise<SeasonFeeSummary> {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!season) throw new Error(`unknown season ${seasonId}`);

  const roster = await db
    .select({ personId: memberships.personId, displayName: persons.displayName })
    .from(memberships)
    .innerJoin(persons, eq(persons.id, memberships.personId))
    .where(eq(memberships.seasonId, seasonId));

  const dueRows = await db
    .select({ id: dues.id, personId: dues.personId, amount: dues.amount, kind: dues.kind })
    .from(dues)
    .where(eq(dues.seasonId, seasonId));

  const paymentRows = await db
    .select({ dueId: payments.dueId, amount: payments.amount })
    .from(payments)
    .innerJoin(dues, eq(dues.id, payments.dueId))
    .where(eq(dues.seasonId, seasonId));

  const paidByDue = new Map<string, number>();
  for (const row of paymentRows) {
    paidByDue.set(row.dueId, (paidByDue.get(row.dueId) ?? 0) + toAgorot(row.amount));
  }

  let expectedAgorot = 0;
  let collectedAgorot = 0;
  let unpaidCount = 0;
  let flatCount = 0;
  let exceptionCount = 0;

  for (const due of dueRows) {
    const owed = toAgorot(due.amount);
    const paid = paidByDue.get(due.id) ?? 0;
    expectedAgorot += owed;
    collectedAgorot += paid;
    if (paid < owed) unpaidCount += 1;
    if (due.kind === 'exception') exceptionCount += 1;
    else flatCount += 1;
  }

  const haveDues = new Set(dueRows.map((row) => row.personId));
  const missingDues = roster
    .filter((row) => !haveDues.has(row.personId))
    .map((row) => row.displayName)
    .sort();

  return {
    seasonId,
    seasonName: season.name,
    flatRateAgorot: toAgorot(season.flatRate),
    memberCount: roster.length,
    flatCount,
    exceptionCount,
    expectedAgorot,
    collectedAgorot,
    // Clamped at zero: an overpayment on one due must never make the
    // season's outstanding go negative and mask someone else's debt.
    outstandingAgorot: Math.max(0, expectedAgorot - collectedAgorot),
    unpaidCount,
    missingDues,
  };
}
