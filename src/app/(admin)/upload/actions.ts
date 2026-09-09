'use server';

import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { seedReferenceWorkbooks, type SeedResult } from '@/lib/import/seed';

export async function seedAction(): Promise<SeedResult> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error('unauthorized');
  return seedReferenceWorkbooks(db);
}
