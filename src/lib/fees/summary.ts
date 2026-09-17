import { eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { seasons, memberships, dues, payments, persons } from '@/db/schema/camp';
import type { DueKind } from '@/db/schema/camp';
import { toAgorot } from '@/lib/money';
import { unattributedAgorot as unattributedMoney } from '@/lib/money/accounts';

/**
 * One row of `unpaid` — plan 04's shape, taken verbatim so the home tile,
 * the people list and this summary can never disagree about who still owes
 * what.
 */
export interface UnpaidMember {
  personId: string;
  displayName: string;
  dueId: string;
  kind: DueKind;
  amountAgorot: number;
  /** Already paid against this due — zero, or a part payment. */
  paidAgorot: number;
  outstandingAgorot: number;
}

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
  /** Collected through the `קיזוז` channel — dues settled against a debt the
   *  camp owed the payer. Part of `collectedAgorot`, never additional to it. */
  offsetAgorot: number;
  /** Dues with at least one `קיזוז` payment on them. */
  offsetPersonCount: number;
  /** Dues money received with no קופה named. Counted in `collectedAgorot`,
   *  present in no account balance. */
  unattributedAgorot: number;
  /** Every due still owing something, largest outstanding first — the row
   *  list a lead scans to see who to chase, including someone who has since
   *  left the roster. */
  unpaid: UnpaidMember[];
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

  // Joined to `persons` here — not resolved through the roster map above —
  // because a due belonging to someone who has since left the roster still
  // needs a name: that is exactly the collection case a lead must not lose.
  const dueRows = await db
    .select({
      id: dues.id,
      personId: dues.personId,
      displayName: persons.displayName,
      amount: dues.amount,
      kind: dues.kind,
    })
    .from(dues)
    .innerJoin(persons, eq(persons.id, dues.personId))
    .where(eq(dues.seasonId, seasonId));

  const paymentRows = await db
    .select({ dueId: payments.dueId, amount: payments.amount, channel: payments.channel })
    .from(payments)
    .innerJoin(dues, eq(dues.id, payments.dueId))
    .where(eq(dues.seasonId, seasonId));

  const paidByDue = new Map<string, number>();
  let offsetAgorot = 0;
  const offsetDues = new Set<string>();
  for (const row of paymentRows) {
    paidByDue.set(row.dueId, (paidByDue.get(row.dueId) ?? 0) + toAgorot(row.amount));
    if (row.channel === 'קיזוז') {
      offsetAgorot += toAgorot(row.amount);
      offsetDues.add(row.dueId);
    }
  }

  let expectedAgorot = 0;
  let collectedAgorot = 0;
  let unpaidCount = 0;
  let flatCount = 0;
  let exceptionCount = 0;
  const unpaid: UnpaidMember[] = [];

  for (const due of dueRows) {
    const owed = toAgorot(due.amount);
    const paid = paidByDue.get(due.id) ?? 0;
    expectedAgorot += owed;
    collectedAgorot += paid;
    if (due.kind === 'exception') exceptionCount += 1;
    else flatCount += 1;
    if (paid < owed) {
      unpaidCount += 1;
      unpaid.push({
        personId: due.personId,
        displayName: due.displayName,
        dueId: due.id,
        kind: due.kind,
        amountAgorot: owed,
        paidAgorot: paid,
        outstandingAgorot: owed - paid,
      });
    }
  }
  unpaid.sort((a, b) => b.outstandingAgorot - a.outstandingAgorot);

  const haveDues = new Set(dueRows.map((row) => row.personId));
  const missingDues = roster
    .filter((row) => !haveDues.has(row.personId))
    .map((row) => row.displayName)
    .sort();

  /**
   * Not re-derived here. `unattributedAgorot` already knows that a `קיזוז`
   * payment moves no cash and so is correctly account-less rather than
   * misfiled, and that rule must have exactly one implementation.
   */
  const unattributed = await unattributedMoney(db, seasonId);

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
    offsetAgorot,
    offsetPersonCount: offsetDues.size,
    unattributedAgorot: unattributed.paymentsAgorot,
    unpaid,
  };
}
