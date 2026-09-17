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


  if (amount < 0) {
    return {
      ok: false,
      refusal: refuse(row, 'negative-amount',
        'הסכום בעמודה הוא בעל סימן. בגיליון זה כל שורה קוראת כחוב שהקאמפ חייב, אז סימן שלילי עלול להיות כיוון הפוך — לא ניתן להכריע בלי ניחוש'),
    };
  }

  const description = (row.cells.description ?? '').trim();
  if (isBlank(description)) {
    return { ok: false, refusal: refuse(row, 'no-description', 'אין תיאור לחוב') };
  }

  // Store only what the schema can represent truthfully. obligations.party_name
  // is nullable, so storing "unknown party" is a truthful fact, and since
  // Task 1, so is obligations.opened_on: it is nullable with no default. A
  // blank date cell, or no `date` mapping at all — most obligations blocks
  // have none — promotes with openedOn: null and a note: the workbook does
  // not say, and null says exactly that. A *non-blank* cell that parseDate
  // cannot read unambiguously is a different case: the sheet asserted a date
  // and got it wrong, and guessing which date it meant would be the same
  // fabrication this function refuses everywhere else, so that still refuses
  // as `no-date`, carrying the unreadable text into the message. The refused
  // row lands in the register with its reason and evidence cells, so the
  // debt is not lost.
  const dateCell = (row.cells.date ?? '').trim();
  const notes: string[] = [];
  let openedOn: Date | null = null;
  if (isBlank(dateCell)) {
    notes.push('בגיליון אין תאריך לחוב הזה');
  } else {
    const parsed = parseDate(dateCell);
    if (!parsed.ok || parsed.date === null) {
      return {
        ok: false,
        refusal: refuse(row, 'no-date', `אין תאריך פתיחה קריא: ${parsed.raw || '(ריק)'}`),
      };
    }
    openedOn = parsed.date;
  }

  // A blank party is NOT a refusal. The camp has two reimbursements whose
  // payee was never recorded; dropping them would lose the debt itself.
  // They become obligations with no party, flagged, and Wave 1 already
  // refuses to let an unnamed obligation be settled.
  const partyCell = (row.cells.party ?? '').trim();
  const partyRaw = isBlank(partyCell) ? null : partyCell;
  if (partyRaw === null) {
    notes.push('החוב נרשם בלי שם — הקאמפ חייב כסף ולא יודע למי');
  }

  const input: NewObligation = {
    direction: 'camp_owes',
    description,
    amount,
    openedOn,
    sourceBlockId: ctx.blockId,
    sourceRow: row.sheetRow,
    ...(ctx.seasonId ? { seasonId: ctx.seasonId } : {}),
  };

  return { ok: true, input, partyRaw, notes };
}
