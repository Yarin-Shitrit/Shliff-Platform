import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import {
  uploads, sheets, blocks, blockMappings, layoutSignatures,
} from '@/db/schema/source';

describe('source schema', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('stores an upload and reads it back', async () => {
    const [row] = await db.insert(uploads).values({
      filename: 'קופת קאמפ 2026.xlsx',
      sha256: 'a'.repeat(64),
      storageKey: 'uploads/test.xlsx',
      sizeBytes: 22002,
      uploadedBy: 'admin@example.com',
    }).returning();

    expect(row.id).toBeDefined();
    expect(row.status).toBe('pending');
    expect(row.filename).toBe('קופת קאמפ 2026.xlsx');
  });

  it('rejects a duplicate sha256', async () => {
    const values = {
      filename: 'x.xlsx',
      sha256: 'b'.repeat(64),
      storageKey: 'uploads/x.xlsx',
      sizeBytes: 10,
      uploadedBy: 'admin@example.com',
    };
    await db.insert(uploads).values(values);
    await expect(db.insert(uploads).values(values)).rejects.toThrow();
  });

  it('cascades sheet and block deletion when an upload is removed', async () => {
    const [upload] = await db.insert(uploads).values({
      filename: 'y.xlsx',
      sha256: 'c'.repeat(64),
      storageKey: 'uploads/y.xlsx',
      sizeBytes: 10,
      uploadedBy: 'admin@example.com',
    }).returning();

    const [sheet] = await db.insert(sheets).values({
      uploadId: upload.id, name: 'סיכום כללי', index: 0, rowCount: 44, colCount: 14,
    }).returning();

    await db.insert(blocks).values({
      sheetId: sheet.id,
      top: 1, left: 1, bottom: 13, right: 4,
      archetype: 'ledger',
      confidence: '0.87',
      pipelineVersion: 1,
      rawGrid: [['תאריך', 'הוצאות']],
    });

    await db.delete(uploads).where(eq(uploads.id, upload.id));

    expect(await db.select().from(sheets)).toHaveLength(0);
    expect(await db.select().from(blocks)).toHaveLength(0);
  });

  it('rejects a second mapping for the same block', async () => {
    const [upload] = await db.insert(uploads).values({
      filename: 'z.xlsx',
      sha256: 'e'.repeat(64),
      storageKey: 'uploads/z.xlsx',
      sizeBytes: 10,
      uploadedBy: 'admin@example.com',
    }).returning();

    const [sheet] = await db.insert(sheets).values({
      uploadId: upload.id, name: 'סיכום כללי', index: 0, rowCount: 44, colCount: 14,
    }).returning();

    const [block] = await db.insert(blocks).values({
      sheetId: sheet.id,
      top: 1, left: 1, bottom: 13, right: 4,
      archetype: 'ledger',
      confidence: '0.87',
      pipelineVersion: 1,
      rawGrid: [['תאריך', 'הוצאות']],
    }).returning();

    const mapping = {
      blockId: block.id,
      columnMap: [{ column: 1, field: 'date', confidence: 1 }],
      source: 'rules',
    };
    await db.insert(blockMappings).values(mapping);
    await expect(db.insert(blockMappings).values(mapping)).rejects.toThrow();
  });

  it('stores a layout signature keyed by fingerprint', async () => {
    const [row] = await db.insert(layoutSignatures).values({
      fingerprint: 'd'.repeat(32),
      archetype: 'budget_lines',
      columnMap: [{ column: 1, field: 'item', confidence: 1 }],
      pipelineVersion: 1,
      confirmedBy: 'admin@example.com',
    }).returning();

    expect(row.fingerprint).toHaveLength(32);
    expect(row.columnMap).toEqual([{ column: 1, field: 'item', confidence: 1 }]);
  });
});
