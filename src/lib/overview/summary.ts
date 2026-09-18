import type { AnyDb } from '@/lib/db-types';
import type { ObligationDirection } from '@/db/schema/money';
import { seasonFeeSummary } from '@/lib/fees/summary';
import type { UnpaidMember } from '@/lib/fees/summary';
import { accountBalances, unattributedAgorot } from '@/lib/money/accounts';
import { listObligations, unnamedObligations } from '@/lib/money/obligations';
import { coverageFor, summarize } from '@/lib/work/coverage';
import type { SeasonCoverage, TaskCoverage } from '@/lib/work/coverage';
import { loadInboxItems, openDecisionCount, blocksPromotion } from '@/lib/inbox/items';
import type { InboxItem, InboxKind } from '@/lib/inbox/items';

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
 * Re-exported rather than re-declared, so the home page can key its glyph map
 * on the register's own kinds without importing the register: the page reads
 * exactly one library aggregate, and its own test holds that line.
 */
export type DecisionKind = InboxKind;

/**
 * One waiting decision, already flattened for a screen that only names it.
 *
 * Deliberately not `InboxItem`: the register's item carries its actions, its
 * evidence and its suggestions, and a preview that took all of it could grow
 * a control that settles a decision from the home screen. What crosses this
 * boundary is a sentence, a cell and a way back to the register.
 */
export interface DecisionRow {
  id: string;
  kind: DecisionKind;
  title: string;
  detail: string;
  /** The workbook cell, printable (R11). Null when it has no single cell. */
  source: string | null;
  /** The register's own verb for this decision, reused as stored (E5). */
  actionLabel: string;
  /** Always the register. A23: the home hands a decision on, never settles it. */
  href: string;
  /**
   * Narrower than "open": promotion itself is waiting on this one. Not a
   * safety control — `blocksPromotion`'s own comment says why — but it is the
   * difference between a queue and a stoppage, and the panel shows it.
   */
  blocksImport: boolean;
}

export interface OpenDecisions {
  /** Every open decision camp-wide, not just the ones shown. */
  total: number;
  /** The first few, in the register's own order: stoppages first. */
  items: DecisionRow[];
}

/** What the panel shows. The rest is stated as a remainder, never dropped. */
const PREVIEW_ROWS = 6;

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
  /** Camp-wide, from the register itself (I2): a decision is open whatever
   *  season you are looking at. */
  decisions: OpenDecisions;
}

/**
 * I2: the count and the rows are two readings of one list, taken in one pass.
 *
 * That is what keeps the panel honest. `openDecisionCount` counts exactly the
 * items the rows are drawn from, so the badge can never report a decision the
 * panel has no row for — the state where a lead is told twelve things are
 * waiting above an empty list. A second query for the count would make that
 * state reachable the first time the two disagreed.
 */
function previewOf(items: readonly InboxItem[]): OpenDecisions {
  return {
    total: openDecisionCount(items),
    items: items
      .filter((item) => item.blocking)
      .slice(0, PREVIEW_ROWS)
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        detail: item.detail,
        source: item.source?.reference ?? null,
        // The register's first action is the verb the mock puts on the row.
        // A decision always offers one; the fallback is there so a future kind
        // that offers none renders a way in rather than an empty control.
        actionLabel: item.actions[0]?.label ?? 'פתיחה ברשימה',
        // Built the way the register builds its own item links: an id can
        // carry a sheet's Hebrew name (`collision:תקציב 26:none`), and a
        // hand-spelled query string would hand back an item nothing matches.
        href: `/inbox?${new URLSearchParams({ item: item.id }).toString()}`,
        blocksImport: blocksPromotion(item),
      })),
  };
}

/**
 * One call, seven aggregates, no query per card.
 *
 * The seventh is the register, and it is the heaviest of them: `loadInboxItems`
 * reads every sheet, block and unlinked name the camp has. It is called here
 * rather than from the page so that the screen keeps its one-call rule — and
 * once, so that the badge and the rows cannot disagree (I2).
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
  // I2's one entry point, called once per request. The default runs no dry
  // run of the promoter, so opening the home screen never exercises a write
  // path — and the badge is identical either way, because a refused row is
  // never a decision.
  const inbox = await loadInboxItems(db, seasonId);

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
    decisions: previewOf(inbox),
  };
}
