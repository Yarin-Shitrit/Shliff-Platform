import { and, asc, eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { dues, seasons, memberships, persons } from '@/db/schema/camp';
import type { DueKind } from '@/db/schema/camp';
import { toAgorot, fromAgorot } from '@/lib/money';
import { isBlank } from '@/lib/text/normalize';

export interface DueRow {
  dueId: string;
  personId: string;
  displayName: string;
  amountAgorot: number;
  kind: DueKind;
  exceptionReason: string | null;
  decidedBy: string | null;
}

export interface ExceptionInput {
  personId: string;
  seasonId: string;
  /** In shekels. Zero is legitimate; negative is not. */
  amount: number;
  reason: string;
  decidedBy: string;
}

/**
 * Gives every roster member without a due the season's flat rate.
 * Idempotent: an existing due — flat or exception — is left exactly as it is,
 * so re-running after recording exceptions never resets anyone.
 * Returns how many dues were created.
 */
export async function issueFlatDues(db: AnyDb, seasonId: string): Promise<number> {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!season) throw new Error(`unknown season ${seasonId}`);

  const roster = await db.select({ personId: memberships.personId })
    .from(memberships).where(eq(memberships.seasonId, seasonId));

  const existing = await db.select({ personId: dues.personId })
    .from(dues).where(eq(dues.seasonId, seasonId));
  const have = new Set(existing.map((row) => row.personId));

  const missing = roster.filter((row) => !have.has(row.personId));
  if (missing.length === 0) return 0;

  await db.insert(dues).values(missing.map((row) => ({
    personId: row.personId,
    seasonId,
    amount: season.flatRate,
    kind: 'flat' as const,
  })));
  return missing.length;
}

/**
 * Records that one person owes something other than the flat rate.
 *
 * The reason and the decider are mandatory. This is a hard refusal, not a
 * warning: the "validation warns, never blocks" rule governs data arriving
 * from a spreadsheet, and a lead typing here is not that. A zero due with no
 * recorded reason is exactly what the camp lost last year.
 */
export async function setException(db: AnyDb, input: ExceptionInput): Promise<void> {
  const reason = input.reason.trim();
  /*
   * Emptiness is judged on the normalized form, not a bare `.trim()`.
   * `.trim()` does not strip LRM, RLM or zero-width marks, and this is a
   * Hebrew RTL admin UI where a browser or OS routinely injects those
   * invisibly during a copy-paste. A reason made only of them would pass a
   * trim check and be stored — recording a materially blank reason as if it
   * were real, which is the exact failure this refusal exists to prevent.
   * The original text is what gets stored; only the check is normalized.
   */
  if (isBlank(input.reason)) {
    throw new Error('an exception must carry a reason');
  }
  if (isBlank(input.decidedBy)) {
    throw new Error('an exception must record who decided it');
  }
  if (input.amount < 0) throw new Error('an exception amount may not be negative');

  const updated = await db.update(dues)
    .set({
      amount: fromAgorot(toAgorot(input.amount)),
      kind: 'exception',
      exceptionReason: reason,
      decidedBy: input.decidedBy,
    })
    .where(and(eq(dues.personId, input.personId), eq(dues.seasonId, input.seasonId)))
    .returning();

  if (updated.length === 0) {
    throw new Error('no due for that person in that season — issue the flat dues first');
  }
}

/** Puts a person back on the season's flat rate. */
export async function clearException(
  db: AnyDb, personId: string, seasonId: string,
): Promise<void> {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!season) throw new Error(`unknown season ${seasonId}`);

  const updated = await db.update(dues)
    .set({
      amount: season.flatRate,
      kind: 'flat',
      exceptionReason: null,
      decidedBy: null,
    })
    .where(and(eq(dues.personId, personId), eq(dues.seasonId, seasonId)))
    .returning();

  // Refuse as loudly as setException does. A mistyped person or season would
  // otherwise report success having changed nothing — the silent-failure shape
  // this module deliberately avoids one function over.
  if (updated.length === 0) {
    throw new Error('no due for that person in that season — nothing to clear');
  }
}

export async function listDues(db: AnyDb, seasonId: string): Promise<DueRow[]> {
  const rows = await db
    .select({
      dueId: dues.id,
      personId: dues.personId,
      displayName: persons.displayName,
      amount: dues.amount,
      kind: dues.kind,
      exceptionReason: dues.exceptionReason,
      decidedBy: dues.decidedBy,
    })
    .from(dues)
    .innerJoin(persons, eq(persons.id, dues.personId))
    .where(eq(dues.seasonId, seasonId))
    .orderBy(asc(persons.displayName));

  return rows.map((row) => ({
    dueId: row.dueId,
    personId: row.personId,
    displayName: row.displayName,
    amountAgorot: toAgorot(row.amount),
    kind: row.kind,
    exceptionReason: row.exceptionReason,
    decidedBy: row.decidedBy,
  }));
}
