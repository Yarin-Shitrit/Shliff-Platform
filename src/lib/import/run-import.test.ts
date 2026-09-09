import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { uploads, sheets, blocks, layoutSignatures } from '@/db/schema/source';
import { runImport } from '@/lib/import/run-import';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';

async function seedUpload(db: TestDb, sha: string): Promise<string> {
  const [row] = await db.insert(uploads).values({
    filename: FIXTURES.y26,
    sha256: sha,
    storageKey: `uploads/${sha}.xlsx`,
    sizeBytes: 22002,
    uploadedBy: 'admin@example.com',
  }).returning();
  return row.id;
}

describe('runImport', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('persists every sheet and block of the 2026 workbook', async () => {
    const uploadId = await seedUpload(db, 'a'.repeat(64));
    const report = await runImport(db, uploadId, fixtureBuffer(FIXTURES.y26));

    expect(report.sheetCount).toBe(5);
    expect(report.blockCount).toBeGreaterThan(5);
    expect(await db.select().from(sheets)).toHaveLength(5);
    expect(await db.select().from(blocks)).toHaveLength(report.blockCount);
  });

  it('marks the upload parsed', async () => {
    const uploadId = await seedUpload(db, 'b'.repeat(64));
    await runImport(db, uploadId, fixtureBuffer(FIXTURES.y26));

    const [row] = await db.select().from(uploads);
    expect(row.status).toBe('parsed');
  });

  it('stores the raw grid of every block', async () => {
    const uploadId = await seedUpload(db, 'c'.repeat(64));
    await runImport(db, uploadId, fixtureBuffer(FIXTURES.y26));

    const stored = await db.select().from(blocks);
    for (const block of stored) {
      expect(Array.isArray(block.rawGrid)).toBe(true);
      expect(block.rawGrid.length).toBe(block.bottom - block.top + 1);
    }
  });

  it('classifies at least one block as a ledger', async () => {
    const uploadId = await seedUpload(db, 'd'.repeat(64));
    await runImport(db, uploadId, fixtureBuffer(FIXTURES.y26));

    const stored = await db.select().from(blocks);
    expect(stored.some((b) => b.archetype === 'ledger')).toBe(true);
  });

  it('reuses a stored layout signature and counts it as auto-recognized', async () => {
    // Import the 25 file first, confirm one of its signatures by hand,
    // then import the 2026 file which shares the ברן 26 budget layout.
    const firstId = await seedUpload(db, 'e'.repeat(64));
    await runImport(db, firstId, fixtureBuffer(FIXTURES.y25));

    const budgetBlock = (await db.select().from(blocks))
      .find((b) => b.archetype === 'budget_lines' && b.fingerprint !== null);
    expect(budgetBlock).toBeDefined();

    await db.insert(layoutSignatures).values({
      fingerprint: budgetBlock!.fingerprint!,
      archetype: 'budget_lines',
      columnMap: [{ column: 1, field: 'item', confidence: 1 }],
      pipelineVersion: budgetBlock!.pipelineVersion,
      confirmedBy: 'admin@example.com',
    });

    const [second] = await db.insert(uploads).values({
      filename: FIXTURES.y26,
      sha256: 'f'.repeat(64),
      storageKey: 'uploads/second.xlsx',
      sizeBytes: 22002,
      uploadedBy: 'admin@example.com',
    }).returning();

    const report = await runImport(db, second.id, fixtureBuffer(FIXTURES.y26));
    expect(report.autoRecognized).toBeGreaterThan(0);
  });

  it('records the failure and rethrows when the file is not a workbook', async () => {
    const uploadId = await seedUpload(db, '0'.repeat(64));
    await expect(
      runImport(db, uploadId, Buffer.from('not a workbook')),
    ).rejects.toThrow();

    const [row] = await db.select().from(uploads);
    expect(row.status).toBe('failed');
    expect(row.error).toBeTruthy();
  });
});
