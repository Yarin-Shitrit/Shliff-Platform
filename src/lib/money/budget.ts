import {
  and, asc, eq, inArray, sql,
} from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { budgetLines, ledgerEntries } from '@/db/schema/money';
import type { BudgetCategory } from '@/db/schema/money';
import { toAgorot, fromAgorot } from '@/lib/money';
import { isBlank, normalizeHebrew } from '@/lib/text/normalize';
import { isArithmeticOff } from './arithmetic';

export interface NewBudgetLine {
  seasonId: string;
  label: string;
  quantityText?: string;
  /** Only when the quantity really is a number. */
  quantityNum?: number;
  unitCost?: number;
  total: number;
  rationale?: string;
  category: BudgetCategory;
  sourceBlockId?: string;
  sourceRow?: number;
}

export interface BudgetLineRow {
  id: string;
  label: string;
  quantityText: string | null;
  quantityNumAgorot: number | null;
  unitCostAgorot: number | null;
  totalAgorot: number;
  rationale: string | null;
  category: BudgetCategory;
  /** `quantity × unit ≠ total`. Flagged, never blocked. */
  arithmeticOff: boolean;
  /** R11: every number keeps its provenance. Null on a line a lead typed. */
  sourceBlockId: string | null;
  sourceRow: number | null;
}

export interface DerivationRow {
  label: string;
  actualAgorot: number | null;
  forecastAgorot: number | null;
  bufferAgorot: number | null;
  rationale: string;
}

export async function createBudgetLine(db: AnyDb, input: NewBudgetLine): Promise<string> {
  if (isBlank(input.label)) throw new Error('לשורת תקציב חייב להיות שם');
  const [row] = await db.insert(budgetLines).values({
    seasonId: input.seasonId,
    label: input.label,
    quantityText: input.quantityText ?? null,
    quantityNum: input.quantityNum === undefined
      ? null : fromAgorot(toAgorot(input.quantityNum)),
    unitCost: input.unitCost === undefined ? null : fromAgorot(toAgorot(input.unitCost)),
    total: fromAgorot(toAgorot(input.total)),
    rationale: input.rationale ?? null,
    category: input.category,
    sourceBlockId: input.sourceBlockId ?? null,
    sourceRow: input.sourceRow ?? null,
  }).returning();
  return row.id;
}

export async function listBudgetLines(
  db: AnyDb, seasonId: string,
): Promise<BudgetLineRow[]> {
  const rows = await db.select().from(budgetLines)
    .where(eq(budgetLines.seasonId, seasonId))
    .orderBy(asc(budgetLines.label));

  return rows.map((row) => {
    const totalAgorot = toAgorot(row.total);
    const quantityNumAgorot = row.quantityNum === null ? null : toAgorot(row.quantityNum);
    const unitCostAgorot = row.unitCost === null ? null : toAgorot(row.unitCost);

    return {
      id: row.id,
      label: row.label,
      quantityText: row.quantityText,
      quantityNumAgorot,
      unitCostAgorot,
      totalAgorot,
      rationale: row.rationale,
      category: row.category,
      arithmeticOff: isArithmeticOff(row.quantityNum === null ? null : row.quantityNum, row.unitCost === null ? null : row.unitCost, totalAgorot),
      sourceBlockId: row.sourceBlockId,
      sourceRow: row.sourceRow,
    };
  });
}

/**
 * With no `category`, the season's whole planned spend — what the "התקציב"
 * table on the money page sums. With one, only that category's lines: the
 * dues/funding identity must use `'camp'` here, because `הגברה` and `מייצג`
 * (category `dancefloor`) are no more part of what a member's dues buy than
 * the year's fundraising targets for the art car or last year's debt are
 * (see `campBudgetFundingAgorot` in `funding.ts`, the same fix one column
 * over).
 */
export async function budgetTotalAgorot(
  db: AnyDb, seasonId: string, category?: BudgetCategory,
): Promise<number> {
  const where = category
    ? and(eq(budgetLines.seasonId, seasonId), eq(budgetLines.category, category))
    : eq(budgetLines.seasonId, seasonId);
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${budgetLines.total}), 0)` })
    .from(budgetLines)
    .where(where);
  return toAgorot(row.total);
}

/**
 * What one season's budget became in the next. Matching is on the normalized
 * label, which is how the workbook itself relates the two sheets.
 *
 * A line present in `from` and absent from `to` is kept with a null forecast
 * and a negative buffer, rather than dropped — a line that disappeared is a
 * budget decision, and hiding it makes the two totals look reconciled when
 * they are not.
 */
export async function budgetDerivation(
  db: AnyDb, fromSeasonId: string, toSeasonId: string,
): Promise<DerivationRow[]> {
  const before = await listBudgetLines(db, fromSeasonId);
  const after = await listBudgetLines(db, toSeasonId);

  const actuals = new Map(before.map((row) => [normalizeHebrew(row.label), row]));
  const carried = new Set(after.map((row) => normalizeHebrew(row.label)));

  const rows: DerivationRow[] = after.map((row) => {
    const actual = actuals.get(normalizeHebrew(row.label)) ?? null;
    return {
      label: row.label,
      actualAgorot: actual ? actual.totalAgorot : null,
      forecastAgorot: row.totalAgorot,
      bufferAgorot: actual ? row.totalAgorot - actual.totalAgorot : null,
      rationale: row.rationale ?? '',
    };
  });

  for (const row of before) {
    if (carried.has(normalizeHebrew(row.label))) continue;
    rows.push({
      label: row.label,
      actualAgorot: row.totalAgorot,
      forecastAgorot: null,
      bufferAgorot: -row.totalAgorot,
      rationale: 'לא נכלל בתקציב הבא',
    });
  }

  return rows;
}

export interface BudgetLineActuals extends BudgetLineRow {
  /** `out` minus `in` over every ledger entry pointing at this line. Not
   *  clamped: a line that took back more than it spent is a fact, and zeroing
   *  it would hide a mis-pointed entry. */
  spentAgorot: number;
  /** `total − spent`, floored at 0. The overshoot lives in `overAgorot`, so a
   *  column of remainders never carries a minus sign a reader must decode. */
  remainingAgorot: number;
  /** `spent − total`, floored at 0. Non-zero is exactly "חריגה". */
  overAgorot: number;
}

/**
 * Every budget line for a season with what the ledger has actually spent
 * against it.
 *
 * Spend is deliberately **not** filtered by the entry's own `season_id`. The
 * budget line already belongs to a season, and R4 makes a season a hand-set
 * label on a continuous ledger — `חוב לירון סלע על ברן 25` is dated June 2026.
 * An entry that points at this line is spend against this line by
 * construction; dropping it because a lead labelled it another year would
 * report a line as untouched while the money is gone.
 *
 * `in` entries are netted against `out` rather than ignored: money that came
 * back to a line is money that line did not spend, and netting is the only
 * reading under which spent + remaining equals the plan.
 */
export async function listBudgetLinesWithActuals(
  db: AnyDb, seasonId: string,
): Promise<BudgetLineActuals[]> {
  const lines = await listBudgetLines(db, seasonId);
  if (lines.length === 0) return [];

  const spend = await db
    .select({
      budgetLineId: ledgerEntries.budgetLineId,
      direction: ledgerEntries.direction,
      total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)`,
    })
    .from(ledgerEntries)
    .where(inArray(ledgerEntries.budgetLineId, lines.map((line) => line.id)))
    .groupBy(ledgerEntries.budgetLineId, ledgerEntries.direction);

  const spentByLine = new Map<string, number>();
  for (const row of spend) {
    if (!row.budgetLineId) continue;
    const signed = row.direction === 'out' ? toAgorot(row.total) : -toAgorot(row.total);
    spentByLine.set(row.budgetLineId, (spentByLine.get(row.budgetLineId) ?? 0) + signed);
  }

  return lines.map((line) => {
    const spentAgorot = spentByLine.get(line.id) ?? 0;
    return {
      ...line,
      spentAgorot,
      remainingAgorot: Math.max(0, line.totalAgorot - spentAgorot),
      overAgorot: Math.max(0, spentAgorot - line.totalAgorot),
    };
  });
}

/** The workbook's own two words for the two halves of a season's spend. */
export const BUDGET_CATEGORY_LABELS: Record<BudgetCategory, string> = {
  camp: 'קאמפ',
  dancefloor: 'רחבה',
};

/** Fixed order. Never sorted by size: a group that moves between seasons
 *  makes two screens of the same page unreadable side by side. */
const CATEGORY_ORDER: BudgetCategory[] = ['camp', 'dancefloor'];

export interface BudgetGroup {
  category: BudgetCategory;
  label: string;
  lines: BudgetLineActuals[];
  plannedAgorot: number;
  spentAgorot: number;
  /** The sum of each line's own remainder, not `planned − spent`. A line that
   *  overran must not quietly consume another line's headroom. */
  remainingAgorot: number;
  count: number;
}

export function groupBudgetByCategory(rows: BudgetLineActuals[]): BudgetGroup[] {
  return CATEGORY_ORDER.flatMap((category) => {
    const lines = rows.filter((row) => row.category === category);
    // An empty category is omitted, not rendered with a zero subtotal: zero
    // asserts a budget of nothing, and the truth is that nothing was recorded.
    if (lines.length === 0) return [];
    return [{
      category,
      label: BUDGET_CATEGORY_LABELS[category],
      lines,
      plannedAgorot: lines.reduce((n, line) => n + line.totalAgorot, 0),
      spentAgorot: lines.reduce((n, line) => n + line.spentAgorot, 0),
      remainingAgorot: lines.reduce((n, line) => n + line.remainingAgorot, 0),
      count: lines.length,
    }];
  });
}

export function budgetTotals(rows: BudgetLineActuals[]): {
  plannedAgorot: number; spentAgorot: number; remainingAgorot: number; count: number;
} {
  return {
    plannedAgorot: rows.reduce((n, row) => n + row.totalAgorot, 0),
    spentAgorot: rows.reduce((n, row) => n + row.spentAgorot, 0),
    remainingAgorot: rows.reduce((n, row) => n + row.remainingAgorot, 0),
    count: rows.length,
  };
}
