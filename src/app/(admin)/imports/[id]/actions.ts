'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { applyConfirmation } from '@/lib/import/confirm';
import { setSheetSeason, setSheetAuthority } from '@/lib/import/sheets';
import { promoteBlock } from '@/lib/import/promote/promote';
import { promoteUpload, blockStates } from '@/lib/import/register';
import { summarise, nextUnreviewed, type PromotionSummary } from '@/lib/import/review';
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

export type PromoteOutcome =
  | { ok: true; summary: PromotionSummary; nextBlockId: string | null }
  | { ok: false; message: string };

const NO_PROMOTE_PERMISSION = 'אין לך הרשאה לאשר טבלאות.';

/**
 * Confirms the block with the map the screen is holding, then promotes it —
 * in that order, in one call. Two round trips would let a lead end up
 * confirmed-but-not-promoted with no button that says so, which is the exact
 * state this screen exists to drain.
 *
 * The archetype passed is the block's stored one: re-picking a type is its own
 * action (`confirmBlock`, from the picker), so `applyConfirmation`'s recompute
 * branch is never reached from here and the draft map is stored verbatim.
 *
 * `budgetCategory` rides along for the same reason it exists at all.
 * `applyConfirmation` rewrites the mapping's category on EVERY confirmation,
 * defaulting a `budget_lines` block to `'camp'` — so a promote that did not
 * carry the lead's choice would quietly reset a dancefloor block to the camp's
 * budget the next time this button was pressed.
 */
export async function confirmAndPromoteAction(
  blockId: string,
  archetype: BlockArchetype,
  columnMap: ColumnMapping[],
  budgetCategory: BudgetCategory | null,
): Promise<PromoteOutcome> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, message: NO_PROMOTE_PERMISSION };

  try {
    await applyConfirmation(
      db, admin.email, blockId, archetype, columnMap, budgetCategory ?? undefined,
    );
    const result = await promoteBlock(db, blockId, {
      dryRun: false, recordedBy: admin.email,
    });

    /**
     * One pass, read after the promotion so the block just finished is no
     * longer open, and narrowed to this file's blocks in memory. The action is
     * given a block id and nothing else, so the upload it belongs to has to be
     * looked up rather than trusted from the browser.
     */
    const all = await blockStates(db);
    const uploadId = all.find((b) => b.blockId === blockId)?.uploadId ?? null;
    const siblings = uploadId === null
      ? []
      : all.filter((b) => b.uploadId === uploadId);

    revalidatePath('/imports/[id]', 'page');
    revalidatePath('/imports');
    return {
      ok: true,
      summary: summarise([result]),
      nextBlockId: nextUnreviewed(siblings, blockId),
    };
  } catch (error) {
    console.error('confirmAndPromoteAction', error);
    return { ok: false, message: refusalMessage(error) };
  }
}

/**
 * Promotes the confirmed blocks of ONE file, and only that file.
 *
 * A34: confirmed blocks, never the ones that already promoted. A re-promotion
 * keeps the rows something else references and writes new ones beside them, so
 * it stays a per-block action on the review screen, where the rows it would
 * keep and the rows it would replace are on the page before it runs.
 *
 * `promoteUpload` composes `promoteBlock` over one upload's blocks. It does not
 * call `promoteAll`, and nothing on this screen may: re-promoting one known
 * block re-inserts two rows the promoter fabricates from a summary sub-table,
 * which together are exactly ברן 26's whole budget — a whole-database
 * promotion doubles it and cannot be repaired afterwards. A lead pressing a
 * button that names a count beside a filename has consented to that file.
 */
export async function promoteUploadAction(uploadId: string): Promise<PromoteOutcome> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, message: NO_PROMOTE_PERMISSION };

  try {
    const results = await promoteUpload(db, uploadId, {
      dryRun: false, recordedBy: admin.email,
    });
    revalidatePath('/imports/[id]', 'page');
    revalidatePath('/imports');
    return { ok: true, summary: summarise(results), nextBlockId: null };
  } catch (error) {
    console.error('promoteUploadAction', error);
    return { ok: false, message: refusalMessage(error) };
  }
}
