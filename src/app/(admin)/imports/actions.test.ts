import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { uploads, sheets, blocks, blockMappings, layoutSignatures } from '@/db/schema/source';
import { applyConfirmation } from '@/lib/import/confirm';

async function seedBlock(db: TestDb, fingerprint: string | null) {
  const [upload] = await db.insert(uploads).values({
    filename: 'x.xlsx', sha256: 'a'.repeat(64), storageKey: 'k',
    sizeBytes: 1, uploadedBy: 'admin@example.com',
  }).returning();
  const [sheet] = await db.insert(sheets).values({
    uploadId: upload.id, name: 'סיכום כללי', index: 0, rowCount: 10, colCount: 4,
  }).returning();
  const [block] = await db.insert(blocks).values({
    sheetId: sheet.id, top: 1, left: 1, bottom: 5, right: 4,
    archetype: 'unknown', confidence: '0.1', headerRow: 1,
    fingerprint, pipelineVersion: 1, rawGrid: [['תאריך']],
  }).returning();
  await db.insert(blockMappings).values({
    blockId: block.id, columnMap: [], source: 'rules',
  });
  return block.id;
}

describe('applyConfirmation', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('updates the block archetype and records who confirmed it', async () => {
    const blockId = await seedBlock(db, 'f'.repeat(32));
    await applyConfirmation(db, 'admin@example.com', blockId, 'ledger', [
      { column: 1, field: 'date', confidence: 1 },
    ]);

    const [row] = await db.select().from(blocks).where(eq(blocks.id, blockId));
    expect(row.archetype).toBe('ledger');
    expect(row.confirmedBy).toBe('admin@example.com');
    expect(row.confirmedAt).toBeInstanceOf(Date);
  });

  it('replaces the block mapping and marks its source as admin', async () => {
    const blockId = await seedBlock(db, 'f'.repeat(32));
    await applyConfirmation(db, 'admin@example.com', blockId, 'ledger', [
      { column: 1, field: 'date', confidence: 1 },
    ]);

    const [mapping] = await db.select().from(blockMappings)
      .where(eq(blockMappings.blockId, blockId));
    expect(mapping.source).toBe('admin');
    expect(mapping.columnMap).toEqual([{ column: 1, field: 'date', confidence: 1 }]);
  });

  it('stores a reusable layout signature', async () => {
    const blockId = await seedBlock(db, 'f'.repeat(32));
    await applyConfirmation(db, 'admin@example.com', blockId, 'ledger', [
      { column: 1, field: 'date', confidence: 1 },
    ]);

    const stored = await db.select().from(layoutSignatures);
    expect(stored).toHaveLength(1);
    expect(stored[0].fingerprint).toBe('f'.repeat(32));
    expect(stored[0].archetype).toBe('ledger');
  });

  it('overwrites an existing signature for the same fingerprint', async () => {
    const first = await seedBlock(db, 'f'.repeat(32));
    await applyConfirmation(db, 'admin@example.com', first, 'ledger', []);
    await applyConfirmation(db, 'admin@example.com', first, 'budget_lines', []);

    const stored = await db.select().from(layoutSignatures);
    expect(stored).toHaveLength(1);
    expect(stored[0].archetype).toBe('budget_lines');
  });

  it('skips signature storage when the block has no fingerprint', async () => {
    const blockId = await seedBlock(db, null);
    await applyConfirmation(db, 'admin@example.com', blockId, 'obligations', []);
    expect(await db.select().from(layoutSignatures)).toHaveLength(0);
  });
});
