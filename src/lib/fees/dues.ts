import { and, asc, eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { dues, seasons, memberships, persons, payments } from '@/db/schema/camp';
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

export interface IssuedFlatDues {
  /** Dues on the season's flat rate — the ones a rate change could rewrite. */
  count: number;
  /** How many of those already have money against them, so the drawer can
   *  say whose balance would move. */
  withPayments: number;
}

export interface FlatRateChange {
  previousAgorot: number;
  nextAgorot: number;
  /** Flat dues rewritten to the new rate — zero unless asked. */
  updatedDues: number;
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
 * The flat dues a season has already issued, and how many carry a payment.
 * Read before a rate change so the drawer can state — with counts — what
 * applying the new rate to them would do, rather than a checkbox saying
 * "also update" over a number nobody has seen.
 */
export async function issuedFlatDues(db: AnyDb, seasonId: string): Promise<IssuedFlatDues> {
  const flat = await db.select({ id: dues.id })
    .from(dues).where(and(eq(dues.seasonId, seasonId), eq(dues.kind, 'flat')));
  if (flat.length === 0) return { count: 0, withPayments: 0 };

  const paid = await db.select({ dueId: payments.dueId })
    .from(payments)
    .innerJoin(dues, eq(dues.id, payments.dueId))
    .where(and(eq(dues.seasonId, seasonId), eq(dues.kind, 'flat')));
  return { count: flat.length, withPayments: new Set(paid.map((row) => row.dueId)).size };
}

/**
 * Changes what a season charges per person.
 *
 * `seasons.flat_rate` is what every *future* due is issued at — `issueFlatDues`,
 * `issueFlatDueFor` and `clearException` all read it at the moment they run.
 * A due already issued carries its own `amount`, so changing the rate alone
 * leaves every existing due exactly where it was. That is one of two honest
 * outcomes, and which one a lead wants is not something this function can
 * know: a rate corrected the day after the dues went out should probably
 * follow through to them; a rate raised mid-season after half the camp has
 * paid probably should not. So `applyToIssued` is a decision the caller
 * makes out loud, never a default, and the drawer states both consequences
 * before the button.
 *
 * Only `flat` dues are ever rewritten. An exception is a recorded decision
 * with a reason and a name beside it, and it was never on the rate.
 *
 * Refuses a negative or non-numeric rate the way `setException` refuses a
 * negative amount; zero is allowed, because a season the camp decides to
 * run without dues is a thing the sidebar already knows how to say.
 */
export async function setFlatRate(
  db: AnyDb, seasonId: string, amount: number, options: { applyToIssued: boolean },
): Promise<FlatRateChange> {
  if (!Number.isFinite(amount)) throw new Error('a flat rate must be a number');
  if (amount < 0) throw new Error('a flat rate may not be negative');

  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!season) throw new Error(`unknown season ${seasonId}`);

  const nextAgorot = toAgorot(amount);
  const next = fromAgorot(nextAgorot);

  await db.update(seasons).set({ flatRate: next }).where(eq(seasons.id, seasonId));

  let updatedDues = 0;
  if (options.applyToIssued) {
    const updated = await db.update(dues)
      .set({ amount: next })
      .where(and(eq(dues.seasonId, seasonId), eq(dues.kind, 'flat')))
      .returning();
    updatedDues = updated.length;
  }

  return { previousAgorot: toAgorot(season.flatRate), nextAgorot, updatedDues };
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
/**
 * Issues the season's flat rate to ONE member.
 *
 * Exists because the row-level control in the dues table says "issue this
 * member's due", and wiring it to the season-wide `issueFlatDues` made it
 * quietly issue everyone's — a button describing a smaller action than it
 * performs, which is the kind of thing a lead only discovers after it has
 * happened.
 *
 * Idempotent, and refuses a person who is not on that season's roster: a due
 * for someone who was never a member has nothing to reconcile against.
 * Returns true when a due was created, false when one already existed.
 */
export async function issueFlatDueFor(
  db: AnyDb, personId: string, seasonId: string,
): Promise<boolean> {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!season) throw new Error(`unknown season ${seasonId}`);

  const [membership] = await db.select().from(memberships).where(
    and(eq(memberships.personId, personId), eq(memberships.seasonId, seasonId)),
  );
  if (!membership) {
    throw new Error('that person is not on this season roster');
  }

  const [existing] = await db.select().from(dues).where(
    and(eq(dues.personId, personId), eq(dues.seasonId, seasonId)),
  );
  if (existing) return false;

  await db.insert(dues).values({
    personId, seasonId, amount: season.flatRate, kind: 'flat',
  });
  return true;
}

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
