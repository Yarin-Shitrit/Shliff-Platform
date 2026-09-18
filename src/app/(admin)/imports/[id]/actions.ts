'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { applyConfirmation } from '@/lib/import/confirm';
import { setSheetSeason, setSheetAuthority } from '@/lib/import/sheets';
import { refusalMessage, type ActionResult } from '@/lib/import/sheet-labels';
import type { ColumnMapping } from '@/lib/classify/map-columns';
import type { BlockArchetype } from '@/lib/classify/types';
import type { BudgetCategory } from '@/db/schema/money';
import { requireAdmin } from '@/lib/auth/guard';

/**
 * Server action wrapper around `applyConfirmation`. Authorization happens
 * here, server-side, every time — a hidden or disabled button in the UI is
 * never the enforcement mechanism.
 *
 * `budgetCategory` is a lead's statement of which budget a `budget_lines`
 * block is, stored on the block's mapping at confirm time (Task 15) and read
 * back by `budgetRow` when the block is promoted. It exists as a parameter
 * here because it is the ONLY way the decision can be made: nothing infers a
 * category, and without it every budget block a lead confirms is stamped
 * `'camp'` — including `תקציב רחבה ברן 25`, which is the dancefloor's. That
 * is R26's 158,507-against-59,587 defect, the dancefloor's spend divided by
 * the camp's headcount, reconstituted through the confirm path; it is
 * unreachable today only because no screen renders a promote button yet.
 *
 * Optional, and omitting it behaves exactly as before — `applyConfirmation`
 * defaults a `budget_lines` block to `'camp'` and stores null for every other
 * archetype. The screen that lets a lead choose passes it.
 */
export async function confirmBlock(
  blockId: string,
  archetype: BlockArchetype,
  columnMap: ColumnMapping[],
  budgetCategory?: BudgetCategory,
): Promise<void> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error('unauthorized');

  await applyConfirmation(db, admin.email, blockId, archetype, columnMap, budgetCategory);

  // Dynamic route revalidation: the literal `[id]` segment (not a real id)
  // revalidates the page type for every upload id, since the confirming
  // request doesn't know which upload this block belongs to.
  revalidatePath('/imports/[id]', 'page');
}

const NO_SHEET_PERMISSION = 'אין לך הרשאה לשנות את פרטי הגיליון.';

/**
 * Both sheet actions take `(prevState, formData)` rather than the bare
 * `FormData` the plan drew, because both of them can be refused and a refusal
 * has to reach the screen.
 *
 * The plan left the signature open and said to decide it with a test. The test
 * settles it: `conflicts()` in `sheets.ts` treats a season-less sheet as
 * colliding with its namesake, so an unlabelled sheet reads `undecided` and the
 * rail shows it the `זה העותק הקובע` button — which `setSheetAuthority` refuses,
 * in Hebrew, for exactly that reason. Returning void and logging would leave a
 * lead pressing a button that changes nothing and says nothing, which is the
 * silent answer the platform forbids. The shape is `useActionState`'s, so the
 * forms still submit and still work with JavaScript disabled.
 */
export async function setSeasonAction(
  _prev: ActionResult | null, form: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, message: NO_SHEET_PERMISSION };

  const sheetId = String(form.get('sheetId') ?? '');
  const raw = String(form.get('seasonId') ?? '');
  try {
    // W10: the season is always set by hand. Nothing here infers one.
    await setSheetSeason(db, sheetId, raw === '' ? null : raw);
    revalidatePath('/imports/[id]', 'page');
    revalidatePath('/imports');
    return { ok: true };
  } catch (error) {
    console.error('setSeasonAction', error);
    return { ok: false, message: refusalMessage(error) };
  }
}

/**
 * W13: exactly one copy of a colliding group is authoritative, chosen by hand.
 * `authoritative=false` is the way out of an `ambiguous` group — two chosen
 * copies otherwise leave a decision with no move that resolves it.
 */
export async function setAuthorityAction(
  _prev: ActionResult | null, form: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, message: NO_SHEET_PERMISSION };

  const sheetId = String(form.get('sheetId') ?? '');
  const authoritative = form.get('authoritative') === 'true';
  try {
    await setSheetAuthority(db, sheetId, authoritative);
    revalidatePath('/imports/[id]', 'page');
    revalidatePath('/imports');
    return { ok: true };
  } catch (error) {
    console.error('setAuthorityAction', error);
    return { ok: false, message: refusalMessage(error) };
  }
}
