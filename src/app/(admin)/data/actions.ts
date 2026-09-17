'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { setSheetSeason, setSheetAuthority } from '@/lib/import/sheets';
import { promoteAll, type BulkResult } from '@/lib/import/promote/promote';

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

export async function promoteAllAction(): Promise<BulkResult> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error('unauthorized');
  // A bulk run can commit some blocks and record failures for others (it no
  // longer throws for a per-block database error — see `promoteAll`), so the
  // revalidation must run whether or not this call throws for some other
  // reason: a partially-committed run must never leave these pages stale.
  try {
    return await promoteAll(db, { dryRun: false, recordedBy: admin.email });
  } finally {
    revalidatePath('/data');
    revalidatePath('/money');
  }
}
