'use server';

import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { seedReferenceWorkbooks, type SeedResult } from '@/lib/import/seed';
import { seedCampBaseline, type CampSeedResult } from '@/lib/seed/camp-seed';

/**
 * Loading the reference workbooks is a development tool: it reads the camp's
 * real historical Excel files off disk (`docs/reference-data/`), which are
 * excluded from every deployed function's trace (see `next.config.ts`) and
 * so would not even be found in production. Refuse before attempting it,
 * with a message an admin can actually read, rather than surfacing whatever
 * file-not-found error a production attempt would produce.
 */
export async function seedAction(): Promise<SeedResult> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error('unauthorized');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('טעינת קבצי העבר היא כלי פיתוח בלבד ואינה זמינה בסביבת ייצור.');
  }
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
