'use server';

import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { seedReferenceWorkbooks, type SeedResult } from '@/lib/import/seed';
import { seedCampBaseline, type CampSeedResult } from '@/lib/seed/camp-seed';

/**
 * Loading the reference workbooks is a development tool: it reads the camp's
 * real historical Excel files off disk (`docs/reference-data/`), which are
 * excluded from every deployed function's trace (see `next.config.ts`) and
 * so would not even be found in production. Refuse before attempting it.
 *
 * Throws machine-readable codes ('unauthorized', 'production'), not Hebrew
 * text — same convention `/api/uploads` uses (see its route handler and
 * `upload-form.tsx`'s `ERROR_MESSAGES`). `seed-button.tsx` maps these to
 * Hebrew; all UI copy in Hebrew is a project-wide rule, and a raw thrown
 * string reaching the client (e.g. `'unauthorized'`, reachable whenever a
 * session lapses between page render and button click) would break it.
 */
export async function seedAction(): Promise<SeedResult> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error('unauthorized');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('production');
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
