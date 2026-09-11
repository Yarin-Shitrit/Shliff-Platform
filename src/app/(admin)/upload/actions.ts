'use server';

import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { seedReferenceWorkbooks, type SeedResult } from '@/lib/import/seed';
import { seedCampBaseline, type CampSeedResult } from '@/lib/seed/camp-seed';

export async function seedAction(): Promise<SeedResult> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error('unauthorized');
  return seedReferenceWorkbooks(db);
}

/**
 * Seeds the roster, dues, offsets and deliverables the workbooks record.
 *
 * Separate from seedAction, which ingests the workbook files themselves. This
 * one reads nothing from disk — it writes the people and money the camp's
 * sheets name. Idempotent, so a lead can press it after a database rebuild
 * without thinking about whether it already ran.
 */
export async function seedCampAction(): Promise<CampSeedResult> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error('unauthorized');
  return seedCampBaseline(db, admin.email);
}
