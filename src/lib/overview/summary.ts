import type { AnyDb } from '@/lib/db-types';
import type { ObligationDirection } from '@/db/schema/money';
import { seasonFeeSummary } from '@/lib/fees/summary';
import type { UnpaidMember } from '@/lib/fees/summary';
import { accountBalances, unattributedAgorot } from '@/lib/money/accounts';
import { listObligations, unnamedObligations } from '@/lib/money/obligations';
import { coverageFor, summarize } from '@/lib/work/coverage';
import type { SeasonCoverage, TaskCoverage } from '@/lib/work/coverage';
import { listUnlinkedNames } from '@/lib/members/identity';

export interface DuesFigure {
  expectedAgorot: number;
  collectedAgorot: number;
  outstandingAgorot: number;
  unpaidCount: number;
  /** Unpaid members who have paid something — the mock's "3 שילמו חלקית". */
  partlyPaidCount: number;
  /** Roster members with no due row at all. Surfaced, never silently skipped. */
  missingDuesCount: number;
  unpaid: UnpaidMember[];
}

export interface CashFigure {
  /** Camp-wide. A קופה does not reset at the burn, so switching seasons must
   *  never appear to change how much cash the camp holds. */
  totalAgorot: number;
  accountCount: number;
  /** Money in with no account named, plus dues payments with no account.
   *  Outflow is deliberately excluded: adding "money that left for somewhere
   *  unknown" to "money that arrived from somewhere unknown" produces a number
   *  that is a quantity of nothing — see `unattributedAgorot`'s own comment.
   *  The outflow is on /money, where it has a sentence of its own. */
  unattributedInAgorot: number;
}

export interface DebtsFigure {
  /** Sums of `outstandingAgorot`, not `amountAgorot` — a partly settled debt
   *  must not be shown as though nothing had been paid against it. */
  campOwesAgorot: number;
  owedToCampAgorot: number;
  /** Camp-wide and every direction, including debts with no season at all. */
  unnamedCount: number;
}

/**
 * Everything the home screen needs, in one call.
 *
 * Each figure is nullable, and `null` means "there is nothing here to report".
 * That is not a formatting nicety: a card that would always read zero teaches
 * its reader to stop looking at the row, and the row is the one that will one
 * day say 6,864 ₪. Keeping the rule in the type means the page cannot draw such
 * a card by accident, and the rule can be tested without rendering anything.
 */
export interface SeasonOverview {
  seasonId: string;
  seasonName: string;
  /** Roster size. Known even before a single due has been issued. */
  memberCount: number;
  flatRateAgorot: number;
  /** Null when no due has been issued: there is no collection to report. */
  dues: DuesFigure | null;
  /** Null when there is no account and nothing unattributed. */
  cash: CashFigure | null;
  /** Null when both directions are settled and nothing is unnamed. */
  debts: DebtsFigure | null;
  /** Null when the season has no open task. Plan 10's shape (I1), inherited
   *  whole rather than re-derived, so `/tasks` and the home tile can never
   *  disagree about `16 מתוך 32`. */
  coverage: SeasonCoverage | null;
  /** Every open task still short of people, biggest gap first. */
  understaffed: TaskCoverage[];
  /** Camp-wide. The one register-shaped fact that exists before plan 05 (I2). */
  unlinkedCount: number;
}

/**
 * One call, seven reads, no query per card.
 *
 * This follows `moneyOverview`'s pattern rather than reusing it: that summary
 * also computes the dues/fundraising identity and the ledger totals, neither of
 * which this screen shows. One summary per page, composed from each domain's
 * own aggregate — never one aggregate stretched across two pages that need
 * different halves of it.
 */
export async function seasonOverview(
  db: AnyDb, seasonId: string,
): Promise<SeasonOverview> {
  const fees = await seasonFeeSummary(db, seasonId);
  const accounts = await accountBalances(db);
  const unattributed = await unattributedAgorot(db, seasonId);
  // Both directions from one read, partitioned here. Two filtered queries
  // would be two round trips for one card.
  const obligations = await listObligations(db, { seasonId });
  // Camp-wide, and deliberately not derived from `obligations` above: a debt
  // with no season matches no `season_id = $1`, so a season-scoped read would
  // leave it on no screen at all.
  const unnamed = await unnamedObligations(db);
  // Read once. The fraction and the gap list are two readings of the same
  // rows, and `seasonCoverageTotals(db, …)` beside `coverageFor(db, …)` would
  // run the same two queries twice for one screen.
  const coverageRows = await coverageFor(db, seasonId);
  const unlinked = await listUnlinkedNames(db);

  const outstandingIn = (direction: ObligationDirection): number => obligations
    .filter((row) => row.direction === direction)
    .reduce((total, row) => total + row.outstandingAgorot, 0);

  const campOwesAgorot = outstandingIn('camp_owes');
  const owedToCampAgorot = outstandingIn('owed_to_camp');
  const unattributedInAgorot = unattributed.inAgorot + unattributed.paymentsAgorot;
  const coverage = summarize(coverageRows);

  const understaffed = coverageRows
    .filter((row) => row.uncovered)
    // Biggest gap first: six missing people is a different problem from one,
    // and the panel shows only the first few rows.
    .sort((a, b) => (b.peopleNeeded - b.accepted) - (a.peopleNeeded - a.accepted)
      || a.title.localeCompare(b.title, 'he'));

  return {
    seasonId,
    seasonName: fees.seasonName,
    memberCount: fees.memberCount,
    flatRateAgorot: fees.flatRateAgorot,
    dues: fees.expectedAgorot === 0 ? null : {
      expectedAgorot: fees.expectedAgorot,
      collectedAgorot: fees.collectedAgorot,
      outstandingAgorot: fees.outstandingAgorot,
      unpaidCount: fees.unpaidCount,
      partlyPaidCount: fees.unpaid.filter((row) => row.paidAgorot > 0).length,
      missingDuesCount: fees.missingDues.length,
      unpaid: fees.unpaid,
    },
    cash: accounts.length === 0 && unattributedInAgorot === 0 ? null : {
      totalAgorot: accounts.reduce((total, row) => total + row.balanceAgorot, 0),
      accountCount: accounts.length,
      unattributedInAgorot,
    },
    debts: campOwesAgorot === 0 && owedToCampAgorot === 0 && unnamed.length === 0
      ? null
      : { campOwesAgorot, owedToCampAgorot, unnamedCount: unnamed.length },
    coverage: coverage.placesNeeded === 0 ? null : coverage,
    understaffed,
    unlinkedCount: unlinked.length,
  };
}
