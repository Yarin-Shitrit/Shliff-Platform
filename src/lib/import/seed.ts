import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import type { TestDb } from '@/test/db';
import { uploads } from '@/db/schema/source';
import { getStorage, sha256Hex } from '@/lib/storage';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';
import { runImport } from './run-import';

export interface SeedResult {
  imported: string[];
  skipped: string[];
}

/**
 * Loads the camp's historical workbooks into the database through the normal
 * import pipeline — the same path an uploaded file takes (write the bytes to
 * storage, record the upload row, then run the pipeline), so seeded data is
 * indistinguishable from imported data and remains re-parseable later without
 * re-uploading.
 *
 * Idempotent by content hash: a workbook that already has a `parsed` upload
 * row is skipped. A row left behind in `pending` or `failed` status — an
 * earlier attempt that never finished or errored — is retried using that same
 * row rather than inserted again, since `uploads.sha256` is unique.
 */
export async function seedReferenceWorkbooks(db: Db | TestDb): Promise<SeedResult> {
  const result: SeedResult = { imported: [], skipped: [] };
  const storage = getStorage();

  for (const filename of [FIXTURES.y2324, FIXTURES.y25, FIXTURES.y26]) {
    const buffer = fixtureBuffer(filename);
    const sha256 = sha256Hex(buffer);

    const existing = await db.select().from(uploads).where(eq(uploads.sha256, sha256));
    if (existing.some((row) => row.status === 'parsed')) {
      result.skipped.push(filename);
      continue;
    }

    let uploadId: string;
    if (existing.length > 0) {
      uploadId = existing[0].id;
    } else {
      const storageKey = `seed/${sha256}.xlsx`;
      await storage.put(storageKey, buffer);
      const [row] = await db.insert(uploads).values({
        filename,
        sha256,
        storageKey,
        sizeBytes: buffer.byteLength,
        uploadedBy: 'seed',
      }).returning();
      uploadId = row.id;
    }

    await runImport(db, uploadId, buffer);
    result.imported.push(filename);
  }

  return result;
}
