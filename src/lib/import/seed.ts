import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import type { TestDb } from '@/test/db';
import { uploads } from '@/db/schema/source';
import { sha256Hex } from '@/lib/storage';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';
import { runImport } from './run-import';

export interface SeedResult {
  imported: string[];
  skipped: string[];
}

/**
 * Loads the camp's historical workbooks into the database through the normal
 * import pipeline — the same path an uploaded file takes, so seeded data is
 * indistinguishable from imported data.
 *
 * Idempotent by content hash: re-seeding skips workbooks already present.
 */
export async function seedReferenceWorkbooks(db: Db | TestDb): Promise<SeedResult> {
  const result: SeedResult = { imported: [], skipped: [] };

  for (const filename of [FIXTURES.y2324, FIXTURES.y25, FIXTURES.y26]) {
    const buffer = fixtureBuffer(filename);
    const sha256 = sha256Hex(buffer);

    const existing = await db.select().from(uploads).where(eq(uploads.sha256, sha256));
    if (existing.length > 0) {
      result.skipped.push(filename);
      continue;
    }

    const [row] = await db.insert(uploads).values({
      filename,
      sha256,
      storageKey: `seed/${sha256}.xlsx`,
      sizeBytes: buffer.byteLength,
      uploadedBy: 'seed',
    }).returning();

    await runImport(db, row.id, buffer);
    result.imported.push(filename);
  }

  return result;
}
