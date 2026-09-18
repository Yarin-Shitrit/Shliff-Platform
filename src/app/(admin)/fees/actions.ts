'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import {
  issueFlatDues, issueFlatDueFor, setException, clearException,
} from '@/lib/fees/dues';
import { recordPayment, deletePayment } from '@/lib/fees/payments';
import type { PaymentChannel } from '@/db/schema/camp';
import { toHebrewError } from '@/lib/errors/hebrew';
import { listOpenAccounts } from '@/lib/money/accounts';
import { FEE_ERRORS } from './error-messages';

/**
 * The Hebrew boundary (R9). Until now this returned `error.message`, which put
 * `an exception must carry a reason` into a `role="alert"` on a Hebrew page.
 */
function failed(error: unknown): ActionResult {
  return { ok: false, error: toHebrewError(error, FEE_ERRORS) };
}

export async function issueDuesAction(seasonId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await issueFlatDues(db, seasonId);
  } catch (error) {
    return failed(error);
  }
  revalidatePath('/fees');
  return { ok: true };
}

/** Issues one member's due. Distinct from issueDuesAction, which fills in
 *  every member missing one — the row control must not silently do that. */
export async function issueDueForAction(
  personId: string, seasonId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await issueFlatDueFor(db, personId, seasonId);
  } catch (error) { return failed(error); }
  revalidatePath('/fees');
  return { ok: true };
}

export async function setExceptionAction(input: {
  personId: string;
  seasonId: string;
  amount: number;
  reason: string;
}): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    // The reason is mandatory here too. The client check is convenience;
    // this one is the rule.
    await setException(db, { ...input, decidedBy: admin.email });
  } catch (error) {
    return failed(error);
  }
  revalidatePath('/fees');
  return { ok: true };
}

export async function clearExceptionAction(
  personId: string,
  seasonId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await clearException(db, personId, seasonId);
  } catch (error) {
    return failed(error);
  }
  revalidatePath('/fees');
  return { ok: true };
}

/**
 * Undoes a payment recorded against the wrong person or with the wrong
 * amount — the most likely data-entry mistake on this page. Without this the
 * only repair is SQL.
 */
export async function deletePaymentAction(paymentId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await deletePayment(db, paymentId);
  } catch (error) {
    return failed(error);
  }
  revalidatePath('/fees');
  return { ok: true };
}

/**
 * Records money received against one due.
 *
 * `accountId` is the field this screen never offered. `payment.account_id` has
 * existed since Wave 1 and `accountBalances` reads it, so every payment typed
 * here before now counted toward collection and toward no קופה. It stays
 * optional: leaving it empty is a legitimate "we do not know yet", and the
 * page reports the total of such money rather than guessing an account.
 *
 * `payment.account_id` carries no foreign key (`camp.ts:120` is a bare
 * `uuid`), so a bad id would be stored in silence. It is checked against the
 * open accounts here, before `recordPayment` is ever called.
 */
export async function recordPaymentAction(input: {
  dueId: string;
  amount: number;
  channel: PaymentChannel;
  paidOn: string;
  note?: string;
  /** Omitted or empty means no קופה: counted in collection, in no balance. */
  accountId?: string;
}): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    if (input.accountId) {
      const open = await listOpenAccounts(db);
      if (!open.some((account) => account.id === input.accountId)) {
        throw new Error('הקופה שנבחרה לא קיימת או נסגרה.');
      }
    }
    await recordPayment(db, {
      dueId: input.dueId,
      amount: input.amount,
      channel: input.channel,
      paidOn: new Date(input.paidOn),
      note: input.note,
      accountId: input.accountId,
      recordedBy: admin.email,
    });
  } catch (error) {
    return failed(error);
  }
  revalidatePath('/fees');
  return { ok: true };
}
