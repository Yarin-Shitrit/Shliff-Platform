'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import { toHebrewError } from '@/lib/errors/hebrew';
import { attributeMovement } from '@/lib/money/attribution';
import { recordEntry } from '@/lib/money/ledger';
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

export interface NewMovementInput {
  occurredOn: string;
  direction: 'in' | 'out';
  /** In shekels. `recordEntry` refuses anything that is not positive. */
  amount: number;
  description: string;
  accountId?: string;
  seasonId?: string;
  budgetLineId?: string;
}

/**
 * Records a movement a lead is typing rather than importing.
 *
 * In scope because the ledger is unreadable as a register if it can only be
 * written by importing a workbook: `/imports` promotes what a sheet already
 * says and `/fees` records dues, so every other shekel the camp handles after
 * the last import would be invisible until somebody edited a spreadsheet.
 * R11's `נרשם ידנית` is a display state no screen could otherwise produce.
 *
 * Every refusal is `recordEntry`'s — a positive amount, a description that is
 * not blank. Nothing is re-validated here, so the form and this action cannot
 * come to disagree with the library about what a movement is.
 */
export async function recordMovementAction(input: NewMovementInput): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await recordEntry(db, {
      occurredOn: new Date(input.occurredOn),
      direction: input.direction,
      amount: input.amount,
      description: input.description,
      // Passed through, never defaulted. A movement with no account lands in
      // the unattributed banner, where a lead can place it; guessing a קופה
      // would put money in one that never held it and leave nothing to
      // notice.
      accountId: input.accountId,
      // Whatever the form chose. Never derived from `occurredOn`: a season is
      // a label set by hand, and `חוב לירון סלע על ברן 25` is dated June 2026.
      seasonId: input.seasonId,
      budgetLineId: input.budgetLineId,
      // From the session, never from the client.
      recordedBy: admin.email,
    });
  } catch (error) {
    return failed(error);
  }
  revalidatePath('/money/ledger');
  revalidatePath('/money');
  return { ok: true };
}
