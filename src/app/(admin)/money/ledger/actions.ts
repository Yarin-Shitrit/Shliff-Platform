'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import { toHebrewError } from '@/lib/errors/hebrew';
import { attributeMovement } from '@/lib/money/attribution';
import type { AttributeInput } from '@/lib/money/attribution';
import { MONEY_ERRORS } from '../error-messages';

/** R9: the boundary where an English message stops. */
function failed(error: unknown): ActionResult {
  return { ok: false, error: toHebrewError(error, MONEY_ERRORS) };
}

/**
 * Gives a movement the account it landed in.
 *
 * Nothing is validated here that `attributeMovement` does not validate: the
 * library owns all four refusals, so a second caller cannot route around
 * them. This function is the guard, the Hebrew boundary and the cache
 * invalidation, and nothing else.
 */
export async function attributeMovementAction(input: AttributeInput): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await attributeMovement(db, input);
  } catch (error) {
    return failed(error);
  }
  revalidatePath('/money/ledger');
  // `/money` shows the same unattributed money in its own banners. Leaving it
  // stale would have one screen say the shekel is placed while the other
  // still asks a lead to place it.
  revalidatePath('/money');
  return { ok: true };
}
