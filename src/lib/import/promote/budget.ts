import type { NewBudgetLine } from '@/lib/money/budget';
import { parseNumber } from '@/lib/coerce/number';
import { parseQuantity } from '@/lib/coerce/quantity';
import { isBlank } from '@/lib/text/normalize';
import { toAgorot } from '@/lib/money';
import type { BlockRow } from './rows';
import { isTotalRow, isBlankRow, refuse } from './rows';
import type { PromoteContext, Refusal } from './types';

export type BudgetOutcome =
  | { ok: true; input: NewBudgetLine; notes: string[] }
  | { ok: false; refusal: Refusal };

export function budgetRow(row: BlockRow, ctx: PromoteContext): BudgetOutcome {
  // budget_lines.season_id is NOT NULL. A budget belonging to no season is
  // not a fact the system can hold, and inventing one would be the guess
  // this wave refuses. Checked first so the register shows one reason.
  if (ctx.seasonId === null) {
    return {
      ok: false,
      refusal: refuse(row, 'no-season', 'לגיליון לא נקבעה עונה, ותקציב חייב עונה'),
    };
  }
  if (isBlankRow(row.raw)) {
    return { ok: false, refusal: refuse(row, 'blank-row', 'שורה ריקה') };
  }
  if (isTotalRow(row.raw)) {
    return {
      ok: false,
      refusal: refuse(row, 'total-row', 'שורת סה״כ היא סכום מחושב, לא סעיף'),
    };
  }

  const total = parseNumber(row.cells.total ?? '');
  if (total === null) {
    return { ok: false, refusal: refuse(row, 'no-amount', 'אין עלות כוללת בשורה') };
  }

  const label = (row.cells.item ?? '').trim();
  if (isBlank(label)) {
    return { ok: false, refusal: refuse(row, 'no-label', 'אין שם לסעיף') };
  }

  // Quantity is stored as the text the workbook holds. Only a genuinely
  // numeric quantity also yields a number — "תפריט שלם לשבוע" yields none.
  const quantity = parseQuantity(row.cells.quantity ?? '');
  const unitCost = parseNumber(row.cells.unit_cost ?? '');
  const rationale = (row.cells.note ?? '').trim();

  const notes: string[] = [];
  if (quantity.value !== null && unitCost !== null) {
    // Unit cost is a rate, not a stored amount. Rounding the rate to whole
    // agorot before multiplying scales the rounding error by the quantity
    // (₪0.335 × 1000 rounds to ₪340, not ₪335). The right approach is to
    // multiply first and round once at the end — toAgorot absorbs float error
    // for any magnitude the camp records. The "never do float arithmetic"
    // rule protects summing stored amounts (src/lib/money.ts), not computing
    // rates. Do not restore the agorot-first pattern — it breaks true rows.
    const expected = toAgorot(quantity.value * unitCost);
    if (expected !== toAgorot(total)) {
      // Flagged, never blocked (W20 / req 11). The workbooks contain three
      // of these and they are the camp's own arithmetic, not ours to fix.
      notes.push('החשבון בשורה לא מסתדר: כמות × מחיר ליחידה שונה מהעלות הכוללת');
    }
  }

  const input: NewBudgetLine = {
    seasonId: ctx.seasonId,
    label,
    total,
    category: 'camp',
    sourceBlockId: ctx.blockId,
    sourceRow: row.sheetRow,
    ...(quantity.text ? { quantityText: quantity.text } : {}),
    ...(quantity.value !== null ? { quantityNum: quantity.value } : {}),
    ...(unitCost !== null ? { unitCost } : {}),
    ...(rationale ? { rationale } : {}),
  };

  return { ok: true, input, notes };
}
