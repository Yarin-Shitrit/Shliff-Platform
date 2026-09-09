import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb, type TestDb } from '@/test/db';
import { uploads, sheets, blocks } from '@/db/schema/source';
import { getStorage, sha256Hex } from '@/lib/storage';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';
import { seedReferenceWorkbooks } from '@/lib/import/seed';

describe('seedReferenceWorkbooks', () => {
  let db: TestDb;
  let storageDir: string;

  beforeEach(async () => {
    db = await createTestDb();
    storageDir = mkdtempSync(join(tmpdir(), 'shliff-seed-'));
    process.env.STORAGE_DRIVER = 'local';
    process.env.LOCAL_STORAGE_DIR = storageDir;
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('imports all three reference workbooks', async () => {
    const result = await seedReferenceWorkbooks(db);
    expect(result.imported).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
    expect(await db.select().from(uploads)).toHaveLength(3);
    expect(await db.select().from(sheets)).toHaveLength(19);
    expect(await db.select().from(blocks)).toHaveLength(29);
  });

  it('is idempotent — seeding twice does not duplicate anything', async () => {
    await seedReferenceWorkbooks(db);
    const second = await seedReferenceWorkbooks(db);

    expect(second.imported).toHaveLength(0);
    expect(second.skipped).toHaveLength(3);
    expect(await db.select().from(uploads)).toHaveLength(3);
    expect(await db.select().from(sheets)).toHaveLength(19);
    expect(await db.select().from(blocks)).toHaveLength(29);
  });

  it('writes the seeded workbook bytes to storage under the recorded storage key', async () => {
    await seedReferenceWorkbooks(db);

    const rows = await db.select().from(uploads);
    for (const row of rows) {
      const stored = await getStorage().get(row.storageKey);
      expect(sha256Hex(stored)).toBe(row.sha256);
    }
  });

  it('retries a previously failed workbook instead of silently skipping it', async () => {
    const buffer = fixtureBuffer(FIXTURES.y26);
    const sha256 = sha256Hex(buffer);
    await db.insert(uploads).values({
      filename: FIXTURES.y26,
      sha256,
      storageKey: `seed/${sha256}.xlsx`,
      sizeBytes: buffer.byteLength,
      uploadedBy: 'seed',
      status: 'failed',
      error: 'boom',
    });

    const result = await seedReferenceWorkbooks(db);

    expect(result.imported).toContain(FIXTURES.y26);
    expect(result.skipped).not.toContain(FIXTURES.y26);

    const rows = await db.select().from(uploads).where(eq(uploads.sha256, sha256));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('parsed');
  });
});
