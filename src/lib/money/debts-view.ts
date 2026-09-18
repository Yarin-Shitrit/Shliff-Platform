import type { AnyDb } from '@/lib/db-types';
import { listObligations, unnamedObligations } from './obligations';
import type { ObligationRow } from './obligations';
import { sourceIndexFor, sourceKey } from './overview';
import type { SourceCell } from './trace';

export type DebtView = 'camp_owes' | 'owed_to_camp' | 'settled';

export interface DebtRow extends ObligationRow {
  /** `openedOn === null`. Rendered as `בגיליון אין תאריך לחוב הזה`, sorted last. */
  dateless: boolean;
  source: SourceCell | null;
}

export interface DebtTotals {
  campOwesAgorot: number; campOwesCount: number;
  owedToCampAgorot: number; owedToCampCount: number;
  settledCount: number;
  unnamedAgorot: number; unnamedCount: number;
  offsetAgorot: number; offsetCount: number;
}

/**
 * Every debt a screen should show for this scope — and the second query is
 * the whole point of the function.
 *
 * ## The season trap
 *
 * A nameless obligation carries no season. The workbook rows that have no
 * party (`שולם 500 — מקפיא באיחסון נוסף`) also have no year beside them, so
 * `obligations.season_id` is NULL for exactly those rows — and in SQL
 * `season_id = $1` never matches NULL. A season-scoped query alone therefore
 * drops every nameless debt, and since the overview now links here rather
 * than listing them itself, `שולם 500 — מקפיא באיחסון נוסף` would appear on
 * **no page at all**. That disappearance is the precise thing requirement 19
 * exists to prevent: a debt nobody can close is the one that must never stop
 * being visible.
 *
 * So a season-scoped call also asks for the camp-wide nameless set and merges
 * the two by id. `summary.ts` already documents and works around the same
 * trap; this is the same workaround, and the screen says so in words.
 *
 * The merge can disturb `listObligations`'s own `asc nulls last` ordering, so
 * the result is re-sorted here rather than assumed.
 */
export async function listDebts(
  db: AnyDb, filter: { seasonId?: string } = {},
): Promise<DebtRow[]> {
  const scoped = await listObligations(db, { seasonId: filter.seasonId });
  const byId = new Map<string, ObligationRow>(scoped.map((row) => [row.id, row]));

  if (filter.seasonId !== undefined) {
    for (const row of await unnamedObligations(db)) {
      // Keyed by id, so a nameless debt that *does* carry this season — it
      // came back in both queries — is one row, not two.
      if (!byId.has(row.id)) byId.set(row.id, row);
    }
  }

  const merged = [...byId.values()].sort(compareByOpened);

  const sources = await sourceIndexFor(db, merged.map((row) => ({
    table: 'obligations' as const, id: row.id, sourceBlockId: row.sourceBlockId,
  })));

  return merged.map((row) => ({
    ...row,
    dateless: row.openedOn === null,
    source: sources.get(sourceKey('obligations', row.id)) ?? null,
  }));
}

/** Oldest first, and every dateless debt after every dated one. The workbook
 *  not saying when a debt opened is a fact about the workbook, not a date of
 *  zero — sorting it as though it were would put it at the top of the page. */
function compareByOpened(a: ObligationRow, b: ObligationRow): number {
  if (a.openedOn === null && b.openedOn === null) return 0;
  if (a.openedOn === null) return 1;
  if (b.openedOn === null) return -1;
  return a.openedOn.getTime() - b.openedOn.getTime();
}

/**
 * `camp_owes` and `owed_to_camp` are the **open** rows of that direction;
 * `settled` is every settled row in both. A settled debt is not news about a
 * direction — it is news about being finished — so it leaves its column
 * rather than sitting in it with a zero.
 */
export function applyDebtView(rows: DebtRow[], view: DebtView): DebtRow[] {
  if (view === 'settled') return rows.filter((row) => row.settled);
  return rows.filter((row) => !row.settled && row.direction === view);
}

export function debtTotals(rows: DebtRow[]): DebtTotals {
  const totals: DebtTotals = {
    campOwesAgorot: 0, campOwesCount: 0,
    owedToCampAgorot: 0, owedToCampCount: 0,
    settledCount: 0,
    unnamedAgorot: 0, unnamedCount: 0,
    offsetAgorot: 0, offsetCount: 0,
  };

  for (const row of rows) {
    // `outstandingAgorot`, never `amountAgorot`. A 15,240 debt with 14,330
    // already settled against it owes 910; totalling the original would tell
    // a lead the camp still owes the whole of it.
    if (row.settled) {
      totals.settledCount += 1;
    } else if (row.direction === 'camp_owes') {
      totals.campOwesAgorot += row.outstandingAgorot;
      totals.campOwesCount += 1;
    } else {
      totals.owedToCampAgorot += row.outstandingAgorot;
      totals.owedToCampCount += 1;
    }

    if (row.unnamed && !row.settled) {
      totals.unnamedAgorot += row.outstandingAgorot;
      totals.unnamedCount += 1;
    }

    // Counted across every row, settled or not: an offset is a fact about how
    // a debt was closed, and the tile that reports it says the money never
    // passed through a קופה.
    for (const settlement of row.settlements) {
      if (settlement.kind !== 'offset') continue;
      totals.offsetAgorot += settlement.amountAgorot;
      totals.offsetCount += 1;
    }
  }

  return totals;
}
