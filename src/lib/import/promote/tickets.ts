import type { NewTicketRound } from '@/lib/money/funding';
import { parseNumber } from '@/lib/coerce/number';
import { isBlank } from '@/lib/text/normalize';
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
    ...(quantity !== null ? { quantity: Math.round(quantity) } : {}),
    ...(price !== null ? { price } : {}),
  };

  return { ok: true, input, notes: [] };
}
