'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { applyConfirmation } from '@/lib/import/confirm';
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
