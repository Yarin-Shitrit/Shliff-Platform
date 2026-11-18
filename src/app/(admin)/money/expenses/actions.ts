'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import { toHebrewError } from '@/lib/errors/hebrew';
import { deleteOwnExpense } from '@/lib/money/expenses';
import { MONEY_ERRORS } from '../error-messages';

/**
 * Removes an expense the signed-in account typed itself. Whose it is comes
 * from the session; `deleteOwnExpense` refuses anybody else's, and the ledger
 * library refuses a movement that is not a lead's to remove.
 */
export async function deleteExpenseAction(entryId: string): Promise<ActionResult> {
  const admin = await requireAdmin('expenses', 'edit');
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await deleteOwnExpense(db, entryId, admin.email);
  } catch (error) {
    return { ok: false, error: toHebrewError(error, MONEY_ERRORS) };
  }
  revalidatePath('/money/expenses');
  revalidatePath('/money/ledger');
  revalidatePath('/money');
  return { ok: true };
}
