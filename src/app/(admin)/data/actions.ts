'use server';

import { revalidatePath } from 'next/cache';
import { eq, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import { blocks, sheets } from '@/db/schema/source';
import { requireAdmin } from '@/lib/auth/guard';
import { setSheetSeason, setSheetAuthority } from '@/lib/import/sheets';
import { promoteBlock, promotedRowCounts, type BulkResult } from '@/lib/import/promote/promote';
import type { PromotionResult } from '@/lib/import/promote/types';

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

/** A confirmed block this run did not promote, and why. */
export interface SkippedBlock {
  blockId: string;
  /** Hebrew, shown to a lead in the register. */
  reason: string;
}

/** `BulkResult` plus the confirmed blocks this run skipped rather than
 *  promoted — a UI needs both halves to say what actually happened. */
export type PromoteAllResult = BulkResult & { skipped: SkippedBlock[] };

const ALREADY_PROMOTED_REASON =
  'לבלוק הזה כבר יש שורות בטבלה, וקידום חוזר עלול לשכפל אותן. '
  + 'כדי לרענן את השורות שלו יש להשתמש בסקריפט ה-cutover, לא בכפתור הזה.';

/**
 * Promotes every confirmed block that has never produced rows. A confirmed
 * block that already owns rows in one of the four target tables is skipped
 * and reported instead of promoted again.
 *
 * This is deliberately not a call to `promoteAll`: `promoteAll` re-promotes
 * every confirmed block unconditionally, and at least one real block's
 * bounds once overran into a summary sub-table, writing two rows that were
 * not budget lines and had to be deleted by hand outside the promoter.
 * Because every promoter upserts on `(source_block_id, source_row)`, and
 * those two rows no longer exist, promoting that block again INSERTS them a
 * second time rather than updating anything — silently doubling a real
 * budget. Scoping by season or by block does not fix this: the junk lives
 * inside that block's own confirmed rows, so a scoped run reinserts it too.
 * The one fact that separates a safe re-run from an unsafe one is whether
 * the block has already produced rows — never has: promotes normally;
 * already has some: skipped here, every time, from every screen. Refreshing
 * a block that already has rows still goes through `scripts/cutover.ts`,
 * which is guarded and evidence-gated, never through this action.
 *
 * The confirmed-block query below is the same one `promoteAll` makes
 * (confirmed blocks, ordered by `sheets.name` then `blocks.top`), written
 * out here rather than passed into `promoteAll` as a filter — the same
 * choice `scripts/cutover.ts`'s `promoteScoped` makes and for the same
 * reason: `promoteAll` is the shared entry point `scripts/cutover.ts` and
 * `scripts/dry-run-promote.ts` both depend on behaving exactly as it does
 * today, so a parameter on it for one caller's gate is everyone's API to
 * carry. The gate belongs here, at the action layer.
 */
export async function promoteAllAction(): Promise<PromoteAllResult> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error('unauthorized');
  // A bulk run can commit some blocks and record failures for others (a
  // per-block database error is caught below rather than thrown, exactly as
  // `promoteAll` does), so the revalidation must run whether or not this
  // call throws for some other reason: a partially-committed run must never
  // leave these pages stale.
  try {
    const confirmed = await db.select({ id: blocks.id })
      .from(blocks)
      .innerJoin(sheets, eq(sheets.id, blocks.sheetId))
      .where(isNotNull(blocks.confirmedAt))
      .orderBy(sheets.name, blocks.top);

    const owned = await promotedRowCounts(db, confirmed.map((row) => row.id));

    const skipped: SkippedBlock[] = [];
    const results: PromotionResult[] = [];
    const failures: { blockId: string; message: string }[] = [];

    for (const { id } of confirmed) {
      if (owned.has(id)) {
        skipped.push({ blockId: id, reason: ALREADY_PROMOTED_REASON });
        continue;
      }
      try {
        // Sequential, as `promoteAll` and `promoteScoped` both are: each
        // block finishes — or rolls back its own transaction — before the
        // next one starts.
        results.push(await promoteBlock(db, id, { dryRun: false, recordedBy: admin.email }));
      } catch (error) {
        failures.push({
          blockId: id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      results,
      writtenCount: results.reduce((n, r) => n + r.written.length, 0),
      refusedCount: results.reduce((n, r) => n + r.refused.length, 0),
      deletedCount: results.reduce((n, r) => n + r.deleted, 0),
      retainedCount: results.reduce((n, r) => n + r.retained.length, 0),
      failures,
      failedCount: failures.length,
      skipped,
    };
  } finally {
    revalidatePath('/data');
    revalidatePath('/money');
  }
}
