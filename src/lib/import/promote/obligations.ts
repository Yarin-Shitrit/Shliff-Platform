import type { NewObligation } from '@/lib/money/obligations';
import { parseNumber } from '@/lib/coerce/number';
import { parseDate } from '@/lib/coerce/date';
import { isBlank } from '@/lib/text/normalize';
import type { BlockRow } from './rows';
import { isTotalRow, isBlankRow, refuse } from './rows';
import type { PromoteContext, Refusal } from './types';

export type ObligationOutcome =
  | { ok: true; input: NewObligation; partyRaw: string | null; notes: string[] }
  | { ok: false; refusal: Refusal };

/**
 * One obligation row.
 *
 * `partyRaw` is handed up rather than resolved here: `resolveName` needs a
 * database, and keeping this function pure is what makes every refusal
 * testable from a cell array. `promote.ts` does the resolving.
 */
export function obligationRow(row: BlockRow, ctx: PromoteContext): ObligationOutcome {
  if (isBlankRow(row.raw)) {
    return { ok: false, refusal: refuse(row, 'blank-row', 'שורה ריקה') };
  }
  if (isTotalRow(row.raw)) {
    return {
      ok: false,
      refusal: refuse(row, 'total-row', 'שורת סה״כ היא סכום מחושב, לא חוב'),
    };
  }

  const amount = parseNumber(row.cells.amount ?? '');
  if (amount === null || amount === 0) {
    return { ok: false, refusal: refuse(row, 'no-amount', 'אין סכום לחוב') };
  }

  const description = (row.cells.description ?? '').trim();
  if (isBlank(description)) {
    return { ok: false, refusal: refuse(row, 'no-description', 'אין תיאור לחוב') };
  }

  const parsed = parseDate(row.cells.date ?? '');
  if (!parsed.ok || parsed.date === null) {
    return {
      ok: false,
      refusal: refuse(row, 'no-date', `אין תאריך פתיחה קריא: ${parsed.raw || '(ריק)'}`),
    };
  }

  // A blank party is NOT a refusal. The camp has two reimbursements whose
  // payee was never recorded; dropping them would lose the debt itself.
  // They become obligations with no party, flagged, and Wave 1 already
  // refuses to let an unnamed obligation be settled.
  const partyCell = (row.cells.party ?? '').trim();
  const partyRaw = isBlank(partyCell) ? null : partyCell;
  const notes: string[] = [];
  if (partyRaw === null) {
    notes.push('החוב נרשם בלי שם — הקאמפ חייב כסף ולא יודע למי');
  }

  const input: NewObligation = {
    direction: 'camp_owes',
    description,
    amount: Math.abs(amount),
    openedOn: parsed.date,
    sourceBlockId: ctx.blockId,
    sourceRow: row.sheetRow,
    ...(ctx.seasonId ? { seasonId: ctx.seasonId } : {}),
  };

  return { ok: true, input, partyRaw, notes };
}
