'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import {
  itemById, setCondition, createItem, updateItem, type ItemInput,
} from '@/lib/logistics/warehouse';
import { createBox, updateBox, type BoxInput } from '@/lib/logistics/boxes';
import { CONDITION_LABELS } from '@/lib/logistics/labels';
import type { ItemCondition } from '@/db/schema/logistics';
import { WAREHOUSE_PATH } from '@/lib/logistics/warehouse-views';
import { boxFailureMessage, conditionFailureMessage, itemFailureMessage } from './failure-messages';

/**
 * This file exports only async functions. A `'use server'` module that exports
 * anything else — a string constant beside its actions — makes Next reject the
 * whole module and return 500 on every route including `/signin`, while tsc,
 * eslint, next build and the unit tests all pass. That happened once here and
 * was caught in a browser, so the labels below are imported rather than
 * declared.
 */

export async function setConditionAction(
  id: string, condition: ItemCondition,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    // Checked rather than trusted: the id arrives from a URL and the condition
    // from a form, and "the system never guesses" cuts both ways — an unknown
    // value becomes a stated refusal, not a silent no-op that looks like it
    // worked.
    if (!(condition in CONDITION_LABELS)) {
      throw new Error(`unknown condition: ${condition}`);
    }
    if (!(await itemById(db, id))) {
      throw new Error(`unknown inventory item ${id}`);
    }

    await setCondition(db, id, condition, admin.email);
    revalidatePath(WAREHOUSE_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: conditionFailureMessage(error) };
  }
}

/**
 * Adding a row by hand, which is the only way anything gets into this
 * warehouse: there is no gear workbook to import from, and R11's answer to
 * that is `נרשם ידנית` on every quantity rather than silence.
 *
 * Returns the new id so the screen can open the drawer over the item that was
 * just created instead of dropping the lead back into an unfiltered list to
 * hunt for it.
 */
export async function createItemAction(input: ItemInput): Promise<ActionResult<string>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    const id = await createItem(db, input, admin.email);
    revalidatePath(WAREHOUSE_PATH);
    return { ok: true, value: id };
  } catch (error) {
    return { ok: false, error: itemFailureMessage(error) };
  }
}

/**
 * The drawer's save. Every field travels every time (see `ItemInput`), so a
 * cleared location arrives as an empty string and is refused, rather than
 * arriving as `undefined` and being read as "leave it alone".
 */
export async function updateItemAction(
  id: string, input: ItemInput,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    await updateItem(db, id, input, admin.email);
    revalidatePath(WAREHOUSE_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: itemFailureMessage(error) };
  }
}

/**
 * A box by hand. Returns the new id so the screen can open the drawer over
 * the box that was just made — the next thing a lead does with a new box is
 * put something in it.
 */
export async function createBoxAction(input: BoxInput): Promise<ActionResult<string>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    const id = await createBox(db, input, admin.email);
    revalidatePath(WAREHOUSE_PATH);
    return { ok: true, value: id };
  } catch (error) {
    return { ok: false, error: boxFailureMessage(error) };
  }
}

/** The box drawer's save. Every field travels every time (see `BoxInput`). */
export async function updateBoxAction(id: string, input: BoxInput): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    await updateBox(db, id, input, admin.email);
    revalidatePath(WAREHOUSE_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: boxFailureMessage(error) };
  }
}
