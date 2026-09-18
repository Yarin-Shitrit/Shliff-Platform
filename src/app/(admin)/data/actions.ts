'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { setSheetSeason, setSheetAuthority } from '@/lib/import/sheets';
import { promoteAllGated, type GatedPromoteResult } from '@/lib/import/promote/promote';

/**
 * Authorization happens here, server-side, on every call. A hidden or
 * disabled control in the UI is never the enforcement mechanism.
 */
export async function setSeasonAction(sheetId: string, seasonId: string | null): Promise<void> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error('unauthorized');
  await setSheetSeason(db, sheetId, seasonId);
  revalidatePath('/data');
}

export async function setAuthorityAction(
  sheetId: string, authoritative: boolean | null,
): Promise<void> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error('unauthorized');
  await setSheetAuthority(db, sheetId, authoritative);
  revalidatePath('/data');
}

/** Re-exported under the name this action has always returned, so a caller
 *  importing `PromoteAllResult` from here sees no shape change even though
 *  the gate itself now lives in the library (`promoteAllGated`) rather than
 *  here — see that function's doc for the hazard this exists to close and
 *  why it is not simply `promoteAll`. */
export type PromoteAllResult = GatedPromoteResult;

/**
 * Thin wrapper: authorize, delegate the whole gated run to the library, and
 * revalidate in `finally` regardless of outcome. The gate itself —
 * confirmed-block query, the skip decision, the per-block loop — lives in
 * `promoteAllGated` (`src/lib/import/promote/promote.ts`) so it can be
 * tested against a real database rather than a mocked one: a mocked `db`
 * cannot fail when the query itself is wrong (wrong filter, dropped join,
 * reversed order), only when the gate's own `if` is wrong, and both need
 * covering.
 */
export async function promoteAllAction(): Promise<PromoteAllResult> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error('unauthorized');
  // A bulk run can commit some blocks and record failures for others (a
  // per-block database error is caught inside `promoteAllGated` rather than
  // thrown), so the revalidation must run whether or not this call throws
  // for some other reason: a partially-committed run must never leave these
  // pages stale.
  try {
    return await promoteAllGated(db, { dryRun: false, recordedBy: admin.email });
  } finally {
    revalidatePath('/data');
    revalidatePath('/money');
  }
}
