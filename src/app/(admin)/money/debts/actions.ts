'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import { toHebrewError, HebrewRefusal } from '@/lib/errors/hebrew';
import {
  listObligations, checkSettlement, settleObligation, nameObligation,
} from '@/lib/money/obligations';
import { recordEntry } from '@/lib/money/ledger';
import { MONEY_ERRORS } from '../error-messages';

function failed(error: unknown): ActionResult {
  return { ok: false, error: toHebrewError(error, MONEY_ERRORS) };
}

export interface SettleInput {
  obligationId: string;
  /** In shekels. */
  amount: number;
  kind: 'cash' | 'offset';
  /** Required on cash, refused on offset. */
  accountId?: string;
  /** Required on offset — `checkSettlement` is what enforces it. */
  note?: string;
  settledOn: string;
}

/**
 * Closes a debt, in cash or by קיזוז.
 *
 * ## The binding rule
 *
 * **A cash settlement writes a ledger entry; an offset writes nothing but the
 * settlement.** Paying a `camp_owes` debt in cash means money left a קופה, so
 * it records an `out` entry against that account and the settlement points at
 * it; somebody repaying an `owed_to_camp` debt records an `in`. An offset
 * moves no cash — it discharges a debt against dues the same person owes — so
 * it touches no account, writes no entry, and appears nowhere in תנועות.
 * Recording one would report every offset-settled debt as fresh cash moving
 * through a קופה that never held it.
 *
 * ## Why the entry is written first
 *
 * The two writes of a cash settlement are sequential awaits, not one
 * transaction — the same compromise `recordTransfer` documents, for the same
 * reason. `checkSettlement` runs first so that every refusal a lead can
 * trigger fires before anything is written at all, which narrows the window
 * to failures nobody can provoke.
 *
 * The order inside that window is deliberate. A database failure between the
 * two leaves a ledger entry with no settlement attached: visible on
 * `/money/ledger` as a plain movement that a lead can see and reconcile, not
 * a silent loss. The reverse order would leave a debt marked settled with no
 * trace of the cash, which is worse — the money would be gone from the record
 * and the debt would look paid.
 */
export async function settleObligationAction(input: SettleInput): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    if (input.kind === 'offset' && input.accountId !== undefined) {
      // `recordPayment`'s own sentence, for the same rule one table over.
      throw new HebrewRefusal('קיזוז אינו מזיז מזומן, ולכן אינו נכנס לחשבון');
    }
    if (input.kind === 'cash' && input.accountId === undefined) {
      throw new HebrewRefusal('סגירה במזומן חייבת לציין מאיזה חשבון יצא הכסף');
    }

    const settledOn = new Date(input.settledOn);
    const settlement = {
      obligationId: input.obligationId,
      amount: input.amount,
      kind: input.kind,
      note: input.note,
      settledOn,
      recordedBy: admin.email,
    };

    // Every refusal, before the first write.
    await checkSettlement(db, settlement);

    if (input.kind === 'offset') {
      await settleObligation(db, settlement);
    } else {
      const debts = await listObligations(db);
      const debt = debts.find((row) => row.id === input.obligationId);
      if (!debt) throw new HebrewRefusal(`חוב לא קיים: ${input.obligationId}`);

      const ledgerEntryId = await recordEntry(db, {
        occurredOn: settledOn,
        // Direction comes from the debt's own direction, never from a sign
        // and never from which field a form filled in.
        direction: debt.direction === 'camp_owes' ? 'out' : 'in',
        amount: input.amount,
        description: `סגירת חוב — ${debt.displayParty}`,
        accountId: input.accountId,
        // Carried over from the obligation, never inferred from today's date:
        // a season is a label a lead sets by hand, and
        // `חוב לירון סלע על ברן 25` is dated June 2026.
        seasonId: debt.seasonId ?? undefined,
        recordedBy: admin.email,
      });
      await settleObligation(db, { ...settlement, ledgerEntryId });
    }
  } catch (error) {
    return failed(error);
  }

  revalidatePath('/money/debts');
  revalidatePath('/money/ledger');
  revalidatePath('/money');
  return { ok: true };
}

export interface NameInput {
  obligationId: string;
  /** Exactly one of the two — `nameObligation` refuses both and neither. */
  personId?: string;
  partyName?: string;
}

/**
 * Records who a debt belongs to, so it can leave the nameless queue and be
 * settled. Every refusal is the library's own sentence; the action adds none.
 *
 * The person's page is revalidated too: a debt that has just been linked to
 * them is now one of their facts, and their dossier must not keep showing a
 * roster with no debts on it.
 */
export async function nameObligationAction(input: NameInput): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    await nameObligation(db, {
      obligationId: input.obligationId,
      partyPersonId: input.personId,
      partyName: input.partyName,
    });
  } catch (error) {
    return failed(error);
  }

  revalidatePath('/money/debts');
  revalidatePath('/money');
  revalidatePath('/inbox');
  if (input.personId) revalidatePath(`/members/${input.personId}`);
  return { ok: true };
}
