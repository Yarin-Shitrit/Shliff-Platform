'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import { toHebrewError, type HebrewErrors } from '@/lib/errors/hebrew';
import { splitAlias } from '@/lib/members/link';
import { ignoreName, unignoreName } from '@/lib/members/identity';
import { setSheetSeason, setSheetAuthority } from '@/lib/import/sheets';
import { snoozeItem, unsnoozeItem } from './snooze';

/**
 * **There is deliberately no bulk-promotion action in this file.**
 *
 * Integration A23, confirmed by the camp lead, forbids the register from
 * offering promotion in bulk. A plain repeated press is in fact safe — the
 * sweep skips the rows the run itself produced and the upsert refreshes them
 * in place. The damage needs the produced set to stop matching what is
 * stored, which a re-detection or a re-import shifting a `source_row` does:
 * the old rows something else references are retained rather than deleted,
 * and the new ones land beside them. **The register cannot know whether a
 * file was re-imported**, so it cannot know which press is the safe one.
 *
 * A23a's remedy is to make the violation unexpressible rather than merely
 * undone, and the cheapest complete form of that here is for the register's
 * action file to export no such function: a control cannot call what does not
 * exist. `actions.test.ts` scans this source and holds the line.
 *
 * `promoteAllAction` therefore does **not** move here from `/data` with its
 * two siblings; it goes away with that route. `promoteAll` and
 * `promoteAllGated` remain in the library for `scripts/cutover.ts`, which is
 * guarded and evidence-gated, which is where a whole-database promotion
 * belongs.
 *
 * The register still shows what promotion *would* do — that is Task 11, and
 * it renders a projection rather than offering to run one.
 */

/**
 * Authorization happens here, server-side, on every call. A hidden or
 * disabled control in the UI is never the enforcement mechanism.
 *
 * Moved from `src/app/(admin)/data/actions.ts` with their bodies untouched —
 * Wave 2 lane A wrote them and this plan relocates rather than reviews them.
 * Only the revalidation target changed, `/data` having become `/inbox`.
 */
export async function setSeasonAction(sheetId: string, seasonId: string | null): Promise<void> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error('unauthorized');
  await setSheetSeason(db, sheetId, seasonId);
  revalidatePath('/inbox');
}

export async function setAuthorityAction(
  sheetId: string, authoritative: boolean | null,
): Promise<void> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error('unauthorized');
  await setSheetAuthority(db, sheetId, authoritative);
  revalidatePath('/inbox');
}

/**
 * This screen's own English-prefix map. Empty on purpose, and that is a
 * statement rather than an omission: every refusal these actions can produce
 * is already a `HebrewRefusal` raised by the domain, which `toHebrewError`
 * resolves before it ever consults a map. Anything that reaches the map is by
 * definition something nobody wrote for a lead to read, and the shared
 * fallback is the honest answer for it.
 */
const INBOX_ERRORS: HebrewErrors = [];

/**
 * R9 at the boundary. `toHebrewError` walks the cause chain itself — a
 * Drizzle error's own message is the parameterised SQL and the real one sits
 * on `.cause` (A27) — so nothing here unwraps first, and A20a forbids a local
 * unwrapper for exactly that reason: unwrapping loses both a marked refusal
 * on an outer link and the wrapper's own message.
 */
function failure(error: unknown): ActionResult {
  return { ok: false, error: toHebrewError(error, INBOX_ERRORS) };
}

export async function ignoreNameAction(aliasId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await ignoreName(db, aliasId, admin.email);
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/inbox');
  revalidatePath('/members');
  return { ok: true };
}

/** The undo behind the toast on `ignoreNameAction`. */
export async function unignoreNameAction(aliasId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await unignoreName(db, aliasId);
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/inbox');
  revalidatePath('/members');
  return { ok: true };
}

export async function splitNameAction(
  aliasId: string, parts: string[],
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  // The count is not re-checked here. `splitAlias` refuses fewer than two
  // names, in Hebrew, as a marked refusal — and one rule in two places is
  // the pair that drifts.
  try {
    await splitAlias(db, aliasId, parts, admin.email);
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/inbox');
  revalidatePath('/members');
  return { ok: true };
}

export async function snoozeItemAction(itemId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await snoozeItem(itemId, new Date());
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/inbox');
  return { ok: true };
}

/** The undo behind the toast on `snoozeItemAction`. */
export async function unsnoozeItemAction(itemId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await unsnoozeItem(itemId);
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/inbox');
  return { ok: true };
}
