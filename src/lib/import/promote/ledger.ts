import type { NewEntry } from '@/lib/money/ledger';
import { parseNumber } from '@/lib/coerce/number';
import { parseDate } from '@/lib/coerce/date';
import { isBlank } from '@/lib/text/normalize';
import type { BlockRow } from './rows';
import { isTotalRow, isCarryForward, isBlankRow, refuse } from './rows';
import type { PromoteContext, Refusal } from './types';

export type LedgerOutcome =
  | { ok: true; input: NewEntry; notes: string[] }
  | { ok: false; refusal: Refusal };

/**
 * One workbook ledger row, as a movement or as a stated refusal.
 *
 * Pure: it never touches the database, so every refusal reason is testable
 * from a cell array alone. The write side lives in `promote.ts`.
 */
export function ledgerRow(row: BlockRow, ctx: PromoteContext): LedgerOutcome {
  if (isBlankRow(row.raw)) {
    return { ok: false, refusal: refuse(row, 'blank-row', 'שורה ריקה') };
  }
  if (isCarryForward(row.raw)) {
    return {
      ok: false,
      refusal: refuse(row, 'carry-forward',
        'מעבר לקובץ חדש הוא סגירת הספר הקודם, לא הכנסה של העונה הזו'),
    };
  }
  if (isTotalRow(row.raw)) {
    return {
      ok: false,
      refusal: refuse(row, 'total-row', 'שורת סה״כ היא סכום מחושב, לא תנועה'),
    };
  }

  const outflow = parseNumber(row.cells.outflow ?? '');
  const inflow = parseNumber(row.cells.inflow ?? '');
  const hasOut = outflow !== null && outflow !== 0;
  const hasIn = inflow !== null && inflow !== 0;

  if (hasOut && hasIn) {
    return {
      ok: false,
      refusal: refuse(row, 'both-directions',
        'בשורה יש גם הוצאה וגם הכנסה — לא ניתן להכריע לאיזה כיוון הכסף זז'),
    };
  }
  if (!hasOut && !hasIn) {
    return { ok: false, refusal: refuse(row, 'no-amount', 'אין סכום בשורה') };
  }

  const chosenAmount = hasOut ? outflow : inflow;
  if (chosenAmount !== null && chosenAmount < 0) {
    return {
      ok: false,
      refusal: refuse(row, 'negative-amount',
        'הסכום בעמודה הוא בעל סימן, והעמודה עצמה קובעת כיוון — לא ניתן להכריע אם זה הוצאה או הכנסה'),
    };
  }

  const parsed = parseDate(row.cells.date ?? '');
  if (!parsed.ok || parsed.date === null) {
    return {
      ok: false,
      refusal: refuse(row, 'no-date', `תאריך לא קריא: ${parsed.raw || '(ריק)'}`),
    };
  }

  const description = (row.cells.description ?? '').trim();
  if (isBlank(description)) {
    return { ok: false, refusal: refuse(row, 'no-description', 'אין תיאור לתנועה') };
  }

  // accountId, eventId and budgetLineId stay unset on purpose (W9): the
  // workbooks name no account for any movement, so attributing one would be
  // invention. Wave 1's unattributed figure already reports this honestly.
  const input: NewEntry = {
    occurredOn: parsed.date,
    direction: hasOut ? 'out' : 'in',
    amount: chosenAmount as number,
    description,
    recordedBy: ctx.recordedBy,
    sourceBlockId: ctx.blockId,
    sourceRow: row.sheetRow,
    ...(ctx.seasonId ? { seasonId: ctx.seasonId } : {}),
  };

  return { ok: true, input, notes: [] };
}
