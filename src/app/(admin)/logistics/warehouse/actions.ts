'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import { itemById, setCondition } from '@/lib/logistics/warehouse';
import { CONDITION_LABELS } from '@/lib/logistics/labels';
import type { ItemCondition } from '@/db/schema/logistics';
import { WAREHOUSE_PATH } from '@/lib/logistics/warehouse-views';
import { conditionFailureMessage } from './failure-messages';

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
