import { eq, inArray } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { formatDateFull } from '@/lib/dates';
import { accounts, budgetLines, ledgerEntries } from '@/db/schema/money';
import type { LedgerDirection } from '@/db/schema/money';
import { dues, payments, persons } from '@/db/schema/camp';
import { listMovements } from './ledger';
import { sourceIndexFor, sourceKey } from './overview';
import type { SourceCell } from './trace';

/** What the database query is scoped by. Anything else is a pure view. */
export interface LedgerScope { seasonId?: string; accountId?: string; eventId?: string }

export interface LedgerRow {
  id: string;
  origin: 'ledger' | 'dues';
  occurredOn: Date;
  direction: LedgerDirection;
  /** Always positive. The column it renders in carries the direction. */
  amountAgorot: number;
  description: string;
  accountId: string | null;
  accountName: string | null;
  /** מ/אל. The dues payer, or the other account of a transfer. Null when the
   *  model knows of no counterpart — never parsed out of the description. */
  counterpartName: string | null;
  counterpartPersonId: string | null;
  isTransfer: boolean;
  budgetLineId: string | null;
  budgetLineLabel: string | null;
  seasonId: string | null;
  /** Null for a dues payment, which carries no provenance columns, and for a
   *  ledger entry a lead typed. Both render `נרשם ידנית`. */
  source: SourceCell | null;
}

/**
 * The ledger, as a table needs it.
 *
 * Built on `listMovements`, never beside it: that function owns the union of
 * `ledger_entries` and `payments`, the rule that a קיזוז is never part of the
 * ledger because it moves no cash, and the rule that an event filter excludes
 * dues payments rather than ignoring itself. A second union query here would
 * be a second home for all three, and two copies of a movement are exactly
 * what the union exists to prevent.
 *
 * The extra columns are read back by id, in a fixed number of queries
 * regardless of how many rows there are. Provenance goes through
 * `sourceIndexFor`, which goes through `traceBlock` — so the cell reference on
 * a table row is built by the same code as the one in a trace, and
 * `ledger-view.test.ts` pins the two together. Nothing here re-derives
 * `sheetName!col+row`; there is one spelling of that in the repo and it is in
 * `trace.ts`.
 */
export async function listLedgerRows(
  db: AnyDb, scope: LedgerScope = {},
): Promise<LedgerRow[]> {
  const movements = await listMovements(db, scope);
  const entryIds = movements.filter((m) => m.source === 'ledger').map((m) => m.id);
  const dueIds = movements.filter((m) => m.source === 'dues').map((m) => m.id);
  const groupIds = [...new Set(movements
    .map((m) => m.transferGroupId)
    .filter((id): id is string => id !== null))];

  const entryRows = entryIds.length === 0 ? [] : await db
    .select({
      id: ledgerEntries.id,
      budgetLineId: ledgerEntries.budgetLineId,
      budgetLineLabel: budgetLines.label,
    })
    .from(ledgerEntries)
    .leftJoin(budgetLines, eq(budgetLines.id, ledgerEntries.budgetLineId))
    .where(inArray(ledgerEntries.id, entryIds));

  const payerRows = dueIds.length === 0 ? [] : await db
    .select({ id: payments.id, personId: dues.personId, displayName: persons.displayName })
    .from(payments)
    .innerJoin(dues, eq(dues.id, payments.dueId))
    .innerJoin(persons, eq(persons.id, dues.personId))
    .where(inArray(payments.id, dueIds));

  // Both legs of every transfer touched by this page, including a leg the
  // page's own scope filtered out — a transfer's counterpart is a fact about
  // the movement, not about the current filter.
  const legRows = groupIds.length === 0 ? [] : await db
    .select({
      transferGroupId: ledgerEntries.transferGroupId,
      direction: ledgerEntries.direction,
      accountName: accounts.name,
    })
    .from(ledgerEntries)
    .leftJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
    .where(inArray(ledgerEntries.transferGroupId, groupIds));

  const sources = await sourceIndexFor(db, movements
    .filter((move) => move.source === 'ledger')
    .map((move) => ({
      table: 'ledger_entries' as const, id: move.id, sourceBlockId: move.sourceBlockId,
    })));

  const byEntry = new Map(entryRows.map((row) => [row.id, row]));
  const byPayment = new Map(payerRows.map((row) => [row.id, row]));
  const opposite = (group: string, direction: LedgerDirection): string | null =>
    legRows.find((leg) => leg.transferGroupId === group && leg.direction !== direction)
      ?.accountName ?? null;

  return movements.map((move) => {
    const entry = byEntry.get(move.id);
    const payer = byPayment.get(move.id);
    return {
      id: move.id,
      origin: move.source,
      occurredOn: move.occurredOn,
      direction: move.direction,
      amountAgorot: move.amountAgorot,
      description: move.description,
      accountId: move.accountId,
      accountName: move.accountName,
      counterpartName: payer?.displayName
        ?? (move.transferGroupId ? opposite(move.transferGroupId, move.direction) : null),
      counterpartPersonId: payer?.personId ?? null,
      isTransfer: move.transferGroupId !== null,
      budgetLineId: entry?.budgetLineId ?? null,
      budgetLineLabel: entry?.budgetLineLabel ?? null,
      seasonId: move.seasonId,
      source: sources.get(sourceKey('ledger_entries', move.id)) ?? null,
    };
  });
}

export type LedgerSort = 'date-asc' | 'date-desc';
export type LedgerView = 'all' | 'in' | 'out' | 'no-account' | 'imported' | 'manual';

export interface LedgerQuery {
  view: LedgerView;
  /** Matched against the description and the counterpart. */
  text?: string;
  budgetLineId?: string;
  sort: LedgerSort;
}

export interface LedgerStrip {
  inAgorot: number; outAgorot: number; netAgorot: number; count: number;
}

export interface MonthGroup { key: string; label: string; count: number; rows: LedgerRow[] }

/** Literal, not `Intl`: ICU month names vary between builds, and a group
 *  header that reads differently on a laptop and on the server is a defect a
 *  test would only catch by accident. */
const MONTHS_HE = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

const MATCHES: Record<LedgerView, (row: LedgerRow) => boolean> = {
  all: () => true,
  in: (row) => row.direction === 'in',
  out: (row) => row.direction === 'out',
  'no-account': (row) => row.accountId === null,
  imported: (row) => row.source !== null,
  manual: (row) => row.source === null,
};

export function applyLedgerView(rows: LedgerRow[], query: LedgerQuery): LedgerRow[] {
  const needle = query.text?.trim().toLowerCase() ?? '';
  const filtered = rows.filter((row) => (
    MATCHES[query.view](row)
    && (!query.budgetLineId || row.budgetLineId === query.budgetLineId)
    && (needle === ''
      || row.description.toLowerCase().includes(needle)
      || (row.counterpartName?.toLowerCase().includes(needle) ?? false))
  ));
  const ascending = [...filtered].sort((a, b) => a.occurredOn.getTime() - b.occurredOn.getTime());
  return query.sort === 'date-asc' ? ascending : ascending.reverse();
}

export function viewCounts(rows: LedgerRow[]): Record<LedgerView, number> {
  const counts = {} as Record<LedgerView, number>;
  for (const view of Object.keys(MATCHES) as LedgerView[]) {
    counts[view] = rows.filter(MATCHES[view]).length;
  }
  return counts;
}

/**
 * A reduce over the rows on screen, never a second query. `ledgerTotals` in
 * `ledger.ts` runs its own query and knows nothing about the views above, so
 * using it here would print a set of figures the table below does not show.
 */
export function ledgerStrip(rows: LedgerRow[]): LedgerStrip {
  let inAgorot = 0;
  let outAgorot = 0;
  for (const row of rows) {
    if (row.direction === 'in') inAgorot += row.amountAgorot;
    else outAgorot += row.amountAgorot;
  }
  return { inAgorot, outAgorot, netAgorot: inAgorot - outAgorot, count: rows.length };
}

/**
 * The year and month a date falls in **in camp time**, read off
 * `formatDateFull` rather than from `getUTCMonth()`.
 *
 * Every date cell in the table below a header is rendered by `dates.ts`,
 * which reads in `Asia/Jerusalem`. A movement stamped 22:00Z on 31 August is
 * 1 September in Israel: UTC grouping would file it under אוגוסט directly
 * above a row whose own date cell says `01/09/26`. Slicing the helper's
 * answer — the same move `chip-source.ts` makes for a cell reference — keeps
 * one timezone decision in the repo instead of two that agree by luck.
 */
function campYearMonth(at: Date): { year: number; month: number } {
  const [, month, year] = formatDateFull(at).split('/');
  return { year: Number(year), month: Number(month) - 1 };
}

export function groupByMonth(rows: LedgerRow[], sort: LedgerSort): MonthGroup[] {
  const groups = new Map<string, MonthGroup>();
  for (const row of rows) {
    const { year, month } = campYearMonth(row.occurredOn);
    const key = `${year}-${String(month + 1).padStart(2, '0')}`;
    const group = groups.get(key)
      ?? { key, label: `${MONTHS_HE[month]} ${year}`, count: 0, rows: [] };
    group.rows.push(row);
    group.count += 1;
    groups.set(key, group);
  }
  const keys = [...groups.keys()].sort();
  if (sort === 'date-desc') keys.reverse();
  return keys.map((key) => groups.get(key)!);
}
