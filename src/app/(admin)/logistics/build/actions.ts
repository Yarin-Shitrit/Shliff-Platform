'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import { addMaterial, removeMaterial, type MaterialInput } from '@/lib/logistics/build';
import { BUILD_PATH } from '@/lib/logistics/build-views';
import { materialFailureMessage } from './failure-messages';

/**
 * Only async functions are exported here. A `'use server'` module that exports
 * anything else makes Next reject the whole module and return 500 on every
 * route, while tsc, eslint, next build and the unit tests all pass — it has
 * happened once in this repo and took a browser to find.
 */

export async function addMaterialAction(input: MaterialInput): Promise<ActionResult<string>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    const id = await addMaterial(db, input);
    revalidatePath(BUILD_PATH);
    return { ok: true, value: id };
  } catch (error) {
    return { ok: false, error: materialFailureMessage(error) };
  }
}

/**
 * A real delete, unlike most writes in this platform, and `build.ts` records
 * why: a material line is not a fact about the world but somebody's statement
 * that a task needs a thing, so withdrawing it leaves nothing unexplained.
 * Neither the stock nor the order it pointed at is touched.
 *
 * The undo is `addMaterialAction` with the same fields — the domain inverse
 * (E2), not a UI stack. The restored row gets a new id, which is correct: the
 * state is what is restored, not the identity.
 */
export async function removeMaterialAction(id: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    await removeMaterial(db, id);
    revalidatePath(BUILD_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: materialFailureMessage(error) };
  }
}
