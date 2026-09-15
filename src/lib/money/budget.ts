import { and, asc, eq, sql } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { budgetLines } from '@/db/schema/money';
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
