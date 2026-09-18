import type { NewTicketRound } from '@/lib/money/funding';
import { isArithmeticOff } from '@/lib/money/arithmetic';
import { parseNumber } from '@/lib/coerce/number';
import { isBlank } from '@/lib/text/normalize';
import { toAgorot } from '@/lib/money';
import type { BlockRow } from './rows';
import { isTotalRow, isBlankRow, refuse } from './rows';
import type { PromoteContext, Refusal } from './types';

export type TicketOutcome =
  | { ok: true; input: NewTicketRound; notes: string[] }
  | { ok: false; refusal: Refusal };

export function ticketRow(row: BlockRow, ctx: PromoteContext): TicketOutcome {
  if (ctx.seasonId === null) {
    return {
      ok: false,
      refusal: refuse(row, 'no-season', 'לגיליון לא נקבעה עונה, וסבב כרטיסים חייב עונה'),
    };
  }
  if (isBlankRow(row.raw)) {
    return { ok: false, refusal: refuse(row, 'blank-row', 'שורה ריקה') };
  }
  if (isTotalRow(row.raw)) {
    return {
      ok: false,
      refusal: refuse(row, 'total-row', 'שורת סה״כ היא סכום מחושב, לא סבב'),
    };
  }

  const total = parseNumber(row.cells.total ?? '');
  if (total === null) {
    return { ok: false, refusal: refuse(row, 'no-amount', 'אין סה״כ לסבב') };
  }

  const label = (row.cells.round ?? '').trim();
  if (isBlank(label)) {
    return { ok: false, refusal: refuse(row, 'no-label', 'אין שם לסבב') };
  }

  const quantity = parseNumber(row.cells.quantity ?? '');
  const price = parseNumber(row.cells.price ?? '');

  // A ticket count is whole or it is not a ticket count. `ticket_rounds.quantity`
  // is `integer`, and `fits` in `promote.ts` already refuses a non-integer for an
  // integer column — but it never saw one, because this function used to apply
  // `Math.round` first and hand the guard a value that always passed.
  //
  // What that cost, in our own committed evidence run: the `SuperNature 3.10`
  // block's bottom bound overran its `סה״כ` into the profit-split table below,
  // and row 11 of that table —
  //
  //     אסף | 0.3333333333 | שליף | 0.6666666667
  //
  // came through with ZERO refusals: a person's name read as a round label,
  // `0.3333333333` rounded silently to a quantity of 0, and `0.6666666667` read
  // as a ₪0.67 total. `isTotalRow`, `isBlankRow`, `no-amount` and `no-label` all
  // pass a row like that, and it sat in the ברן 26 season the cutover promotes.
  // A fabricated round the workbook never states is worse than a refused one, so
  // the fraction is refused at its root rather than annotated after the fact.
  //
  // `out-of-range` is the right existing reason: the value is one the target
  // column genuinely cannot hold, which is what that reason means. The message
  // names the cell and the value, because the number a lead has to go and look
  // at is the whole point of the refusal.
  if (quantity !== null && !Number.isInteger(quantity)) {
    return {
      ok: false,
      refusal: refuse(row, 'out-of-range',
        `הערך ${row.cells.quantity} בעמודת כמות אינו מספר שלם, וכמות כרטיסים `
        + 'חייבת להיות שלמה. בדקו אם השורה היא בכלל סבב כרטיסים'),
    };
  }

  // The same reconciliation `budgetRow` applies, for the same reason (W20 /
  // req 11): flagged, never blocked. `budgetRow` had it and `ticketRow` did not,
  // and that asymmetry is why the `אסף` row above was caught by a human reading
  // all 93 would-write lines rather than by the run itself. A sub-table row that
  // slips past every refusal now at least carries a note when its own arithmetic
  // does not close.
  const notes: string[] = [];
  if (isArithmeticOff(quantity, price, toAgorot(total))) {
    notes.push('החשבון בשורה לא מסתדר: כמות × מחיר שונה מהסה״כ');
  }

  // eventId stays unset: linking a round to one of the camp's events is a
  // judgement a lead makes, not something a label can be matched on.
  // `sold` keeps its default false — the column does not reliably
  // distinguish planned from sold, and claiming otherwise would be a guess.
  const input: NewTicketRound = {
    seasonId: ctx.seasonId,
    label,
    total,
    sourceBlockId: ctx.blockId,
    sourceRow: row.sheetRow,
    // No `Math.round` here any more: a non-integer was refused above, so
    // rounding could only ever be a no-op that hid the refusal it replaced.
    ...(quantity !== null ? { quantity } : {}),
    ...(price !== null ? { price } : {}),
  };

  return { ok: true, input, notes };
}
