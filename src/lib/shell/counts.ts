import type { AnyDb } from '@/lib/db-types';
import { listUnlinkedNames } from '@/lib/members/identity';
import { listSheets, sheetEligibility } from '@/lib/import/sheets';
import { unnamedObligations } from '@/lib/money/obligations';
import { listRoster } from '@/lib/members/roster';
import { uncoveredTasks } from '@/lib/work/coverage';

export interface ShellCounts {
  /** Camp-wide: a decision is open whatever season you are looking at. */
  openDecisions: number;
  rosterSize: number;
  understaffedTasks: number;
}

/**
 * The three figures B2 puts on the rail. Composed from queries that already
 * exist; this module owns no SQL of its own, because a count in the chrome
 * that disagrees with the page it links to is worse than no count.
 *
 * `openDecisions` covers four of D2's seven kinds today: unlinked names,
 * seasonless sheets, contested copies, and nameless debts. Unconfirmed
 * blocks, refused rows and arithmetic flags have no query yet; the inbox
 * plan adds `openDecisionCount` and this function delegates to it without
 * changing `ShellCounts`.
 *
 * A null season means "the camp has no seasons at all". The season-scoped
 * figures are then zero rather than guessed, and B2's rule hides them.
 */
export async function shellCounts(
  db: AnyDb, seasonId: string | null,
): Promise<ShellCounts> {
  const [unlinked, sheets, eligibility, nameless] = await Promise.all([
    listUnlinkedNames(db),
    listSheets(db),
    sheetEligibility(db),
    unnamedObligations(db),
  ]);

  // A sheet can be both seasonless and contested. It is one decision either
  // way, so the ids go through a set rather than two additions.
  const undecidedSheets = new Set<string>();
  for (const sheet of sheets) {
    if (sheet.seasonId === null) undecidedSheets.add(sheet.id);
  }
  for (const [sheetId, state] of eligibility) {
    if (state.state === 'undecided' || state.state === 'ambiguous') {
      undecidedSheets.add(sheetId);
    }
  }

  const openDecisions = unlinked.length + undecidedSheets.size + nameless.length;

  if (seasonId === null) {
    return { openDecisions, rosterSize: 0, understaffedTasks: 0 };
  }

  const [roster, uncovered] = await Promise.all([
    listRoster(db, seasonId),
    uncoveredTasks(db, seasonId),
  ]);

  return {
    openDecisions,
    rosterSize: roster.length,
    understaffedTasks: uncovered.length,
  };
}
