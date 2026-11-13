import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import type { AnyDb } from '@/lib/db-types';
import { seasons } from '@/db/schema/camp';
import type { ObligationDirection } from '@/db/schema/money';
import { HebrewRefusal } from '@/lib/errors/hebrew';
import { listSeasonFees } from './season-fees';
import { recordOffset } from './payments';
import { listObligations, settleObligation } from '@/lib/money/obligations';

/**
 * Closing a season's balances: the starting point.
 *
 * ## What this is for
 *
 * The camp did not keep its book through last year, and the lead's word is
 * that everyone has since received and paid what they were owed. What the
 * screens still show — a member's `+ 1,500 ₪ משנים אחרות`, a debt from
 * ברן 25 still open — is a record nobody will act on, and every figure
 * built on it (the people list's יתרה, the money page's חובות) is wrong in
 * the same direction. So the lead closes the year: every open balance of
 * that season goes to zero, in one act, with one note.
 *
 * ## Why a write-off and not a delete
 *
 * Deleting a due deletes its payments with it (`payments.due_id` cascades),
 * so "delete the balances" would erase what people *did* pay — the one part
 * of last year's record that is known to be true. Instead each open due is
 * settled by a `קיזוז` payment, and each open named debt by an `offset`
 * settlement, both carrying the closing note. A קיזוז moves no cash: it
 * enters no קופה, it appears in no ledger, so no balance counted under
 * `countAccount` moves. The due, the payments and the debt stay readable,
 * the figure reads zero, and a lead who opens a person's page a year from
 * now sees *why* — which a deleted row could never say.
 *
 * It is also undoable the way every write here is: delete the payment or
 * the settlement, and the balance is back.
 *
 * ## What it refuses to touch
 *
 * An unnamed obligation (no person, no name) can never be settled —
 * `checkSettlement` refuses it, because closing it would close the only
 * record that anyone is owed anything. The preview counts them so the
 * drawer can say they stay open, and the close skips them rather than
 * failing on the first. A member with no due issued has nothing open and
 * nothing to close; they are counted for the same reason.
 */

export interface OpenDue {
  dueId: string;
  personId: string;
  displayName: string;
  outstandingAgorot: number;
}

export interface OpenObligation {
  id: string;
  direction: ObligationDirection;
  displayParty: string;
  description: string;
  outstandingAgorot: number;
}

export interface SeasonClosePreview {
  seasonId: string;
  seasonName: string;
  dues: { rows: OpenDue[]; count: number; totalAgorot: number };
  /** Roster members with no due issued: nothing open, nothing to close. */
  unissued: number;
  obligations: {
    rows: OpenObligation[];
    count: number;
    campOwesAgorot: number;
    owedToCampAgorot: number;
  };
  /** Open debts with no party at all. They cannot be closed, and the
   *  drawer says so. */
  unnamed: number;
}

export async function seasonClosePreview(db: AnyDb, seasonId: string): Promise<SeasonClosePreview> {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!season) throw new HebrewRefusal('השנה הזאת לא נמצאה.');

  const fees = await listSeasonFees(db, seasonId);
  const openDues: OpenDue[] = fees
    .filter((row) => row.dueId !== null && row.outstandingAgorot > 0)
    .map((row) => ({
      dueId: row.dueId!,
      personId: row.personId,
      displayName: row.displayName,
      outstandingAgorot: row.outstandingAgorot,
    }));

  const debts = (await listObligations(db, { seasonId })).filter((row) => !row.settled);
  const openDebts: OpenObligation[] = debts
    .filter((row) => !row.unnamed && row.outstandingAgorot > 0)
    .map((row) => ({
      id: row.id,
      direction: row.direction,
      displayParty: row.displayParty ?? '',
      description: row.description,
      outstandingAgorot: row.outstandingAgorot,
    }));

  const sum = (rows: OpenObligation[], direction: ObligationDirection) => rows
    .filter((row) => row.direction === direction)
    .reduce((total, row) => total + row.outstandingAgorot, 0);

  return {
    seasonId,
    seasonName: season.name,
    dues: {
      rows: openDues,
      count: openDues.length,
      totalAgorot: openDues.reduce((total, row) => total + row.outstandingAgorot, 0),
    },
    unissued: fees.filter((row) => row.dueId === null).length,
    obligations: {
      rows: openDebts,
      count: openDebts.length,
      campOwesAgorot: sum(openDebts, 'camp_owes'),
      owedToCampAgorot: sum(openDebts, 'owed_to_camp'),
    },
    unnamed: debts.filter((row) => row.unnamed).length,
  };
}

export interface CloseSeasonInput {
  seasonId: string;
  /** Zero every member's open due of this season. */
  dues: boolean;
  /** Settle every open named debt of this season, in both directions. */
  obligations: boolean;
  closedOn: Date;
  recordedBy: string;
}

export interface CloseSeasonResult {
  duesClosed: number;
  duesAgorot: number;
  obligationsClosed: number;
  obligationsAgorot: number;
  /** Debts left open because they name nobody. */
  unnamedLeft: number;
}

/** The note every write-off carries — the thing a reader finds a year on. */
export function closingNote(seasonName: string): string {
  return `סגירת ${seasonName}: היתרה אופסה כנקודת התחלה — כולם קיבלו ושילמו את המגיע להם`;
}

/**
 * Zeroes the season's open balances. The preview is computed again here
 * rather than taken from the caller, so what is written is what is open at
 * the moment of writing, not what a drawer showed a minute earlier.
 *
 * Two refusals, both `HebrewRefusal` (§5 A20): nothing chosen, and nothing
 * open to close among what was chosen — a close that writes nothing must
 * say so rather than report success over an empty year.
 *
 * One transaction, behind a lock on the season's row. It was neither:
 * the preview was read and the write-offs written one after another on
 * the open connection. Two leads pressing together each read the same
 * open dues and each wrote a full write-off for them — `recordPayment`
 * has no overpayment guard — and a debt that failed midway left the dues
 * already written off under a screen reporting failure. Now the second
 * close waits for the first, reads nothing open, and is refused; and a
 * failure anywhere writes nothing.
 */
export async function closeSeasonBalances(
  db: AnyDb, input: CloseSeasonInput,
): Promise<CloseSeasonResult> {
  if (!input.dues && !input.obligations) {
    throw new HebrewRefusal('בחרו מה לסגור: חיובים, חובות, או שניהם.');
  }
  return (db as Db).transaction(async (tx) => {
    const scoped = tx as unknown as AnyDb;
    await tx.select({ id: seasons.id }).from(seasons).where(eq(seasons.id, input.seasonId)).for('update');
    return closeInside(scoped, input);
  });
}

async function closeInside(db: AnyDb, input: CloseSeasonInput): Promise<CloseSeasonResult> {
  const preview = await seasonClosePreview(db, input.seasonId);
  const duesToClose = input.dues ? preview.dues.rows : [];
  const debtsToClose = input.obligations ? preview.obligations.rows : [];
  if (duesToClose.length === 0 && debtsToClose.length === 0) {
    throw new HebrewRefusal(`אין יתרות פתוחות לסגור ב${preview.seasonName}.`);
  }

  const note = closingNote(preview.seasonName);

  if (duesToClose.length > 0) {
    await recordOffset(db, {
      entries: duesToClose.map((row) => ({
        dueId: row.dueId, amount: row.outstandingAgorot / 100,
      })),
      note,
      paidOn: input.closedOn,
      recordedBy: input.recordedBy,
    });
  }

  // Sequential, and inside the caller's transaction: a failure on any debt
  // rolls back the dues and the debts before it.
  for (const debt of debtsToClose) {
    await settleObligation(db, {
      obligationId: debt.id,
      amount: debt.outstandingAgorot / 100,
      kind: 'offset',
      note,
      settledOn: input.closedOn,
      recordedBy: input.recordedBy,
    });
  }

  return {
    duesClosed: duesToClose.length,
    duesAgorot: duesToClose.reduce((total, row) => total + row.outstandingAgorot, 0),
    obligationsClosed: debtsToClose.length,
    obligationsAgorot: debtsToClose.reduce((total, row) => total + row.outstandingAgorot, 0),
    unnamedLeft: input.obligations ? preview.unnamed : 0,
  };
}
