'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { applyConfirmation } from '@/lib/import/confirm';
import type { ColumnMapping } from '@/lib/classify/map-columns';
import type { BlockArchetype } from '@/lib/classify/types';
import { requireAdmin } from '@/lib/auth/guard';

/**
 * Server action wrapper around `applyConfirmation`. Authorization happens
 * here, server-side, every time — a hidden or disabled button in the UI is
 * never the enforcement mechanism.
 */
export async function confirmBlock(
  blockId: string,
  archetype: BlockArchetype,
  columnMap: ColumnMapping[],
): Promise<void> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error('unauthorized');

  await applyConfirmation(db, admin.email, blockId, archetype, columnMap);

  // Dynamic route revalidation: the literal `[id]` segment (not a real id)
  // revalidates the page type for every upload id, since the confirming
  // request doesn't know which upload this block belongs to.
  revalidatePath('/imports/[id]', 'page');
}
