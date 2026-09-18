import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { uploads, sheets, blocks, blockMappings } from '@/db/schema/source';
import { seasons } from '@/db/schema/camp';
import { listUploads, uploadStatusLabel } from './uploads';

const LEAD = 'lead@shliff.test';

describe('uploadStatusLabel', () => {
  it('says a failed parse failed', () => {
    expect(uploadStatusLabel({
      status: 'failed', blockCount: 0, confirmedCount: 0, promotedRows: 0,
    })).toEqual({ text: 'נכשל', tone: 'bad' });
  });

  it('says so when a workbook parsed but held no table', () => {
    expect(uploadStatusLabel({
      status: 'parsed', blockCount: 0, confirmedCount: 0, promotedRows: 0,
    })).toEqual({ text: 'לא נמצאו טבלאות', tone: 'warn' });
  });

  it('counts what is left rather than what is done', () => {
    expect(uploadStatusLabel({
      status: 'parsed', blockCount: 11, confirmedCount: 3, promotedRows: 0,
    })).toEqual({ text: '8 לבדיקה', tone: 'brand' });
  });

  it('says a fully confirmed file is ready, not finished', () => {
    expect(uploadStatusLabel({
      status: 'parsed', blockCount: 11, confirmedCount: 11, promotedRows: 0,
    })).toEqual({ text: 'מוכן לקידום', tone: 'brand' });
  });

  it('calls a file promoted only when rows exist, never on the status column', () => {
    expect(uploadStatusLabel({
      status: 'parsed', blockCount: 11, confirmedCount: 11, promotedRows: 52,
    })).toEqual({ text: 'הוקדם', tone: 'ok' });
    expect(uploadStatusLabel({
      status: 'committed', blockCount: 11, confirmedCount: 11, promotedRows: 0,
    })).toEqual({ text: 'מוכן לקידום', tone: 'brand' });
  });
});

describe('listUploads', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('returns the newest upload first, with who uploaded it and when', async () => {
    await db.insert(uploads).values([
      { filename: 'ישן.xlsx', sha256: 'a'.repeat(64), storageKey: 'k1',
        sizeBytes: 1, uploadedBy: LEAD,
        createdAt: new Date('2026-09-01T08:00:00Z') },
      { filename: 'חדש.xlsx', sha256: 'b'.repeat(64), storageKey: 'k2',
        sizeBytes: 1, uploadedBy: 'שירה',
        createdAt: new Date('2026-09-12T08:00:00Z') },
    ]);

    const rows = await listUploads(db);
    expect(rows.map((r) => r.filename)).toEqual(['חדש.xlsx', 'ישן.xlsx']);
    expect(rows[0].uploadedBy).toBe('שירה');
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it('counts a sheet with no season as an open decision', async () => {
    const [upload] = await db.insert(uploads).values({
      filename: 'x.xlsx', sha256: 'c'.repeat(64), storageKey: 'k',
      sizeBytes: 1, uploadedBy: LEAD,
    }).returning();
    await db.insert(sheets).values({
      uploadId: upload.id, name: 'מסיבות', index: 0, rowCount: 5, colCount: 3,
    });

    const [row] = await listUploads(db);
    expect(row.sheetCount).toBe(1);
    expect(row.openDecisions).toBe(1);
  });

  it('points המשך סקירה at the first block still needing a human', async () => {
    const [upload] = await db.insert(uploads).values({
      filename: 'y.xlsx', sha256: 'd'.repeat(64), storageKey: 'k',
      sizeBytes: 1, uploadedBy: LEAD,
    }).returning();
    // The sheet gets a season so that `openDecisions` here isolates the block
    // that needs review. A season-less sheet is its own open decision and is
    // covered by the test above; leaving one here would let this assertion
    // pass at 1 while counting the sheet and hiding the block.
    const [season] = await db.insert(seasons)
      .values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    const [sheet] = await db.insert(sheets).values({
      uploadId: upload.id, name: 'א', index: 0, rowCount: 5, colCount: 3,
      seasonId: season.id,
    }).returning();
    const [done] = await db.insert(blocks).values({
      sheetId: sheet.id, top: 1, left: 1, bottom: 2, right: 2,
      archetype: 'ledger', confidence: '1.0000', headerRow: 1,
      fingerprint: null, pipelineVersion: 1, rawGrid: [['תאריך']],
      confirmedBy: LEAD, confirmedAt: new Date(),
    }).returning();
    const [open] = await db.insert(blocks).values({
      sheetId: sheet.id, top: 4, left: 1, bottom: 9, right: 2,
      archetype: 'unknown', confidence: '0.2000', headerRow: 4,
      fingerprint: null, pipelineVersion: 1, rawGrid: [['?']],
    }).returning();
    await db.insert(blockMappings).values([
      { blockId: done.id, columnMap: [{ column: 1, field: 'date', confidence: 1 }],
        source: 'admin' },
      { blockId: open.id, columnMap: [], source: 'rules' },
    ]);

    const [row] = await listUploads(db);
    expect(row.blockCount).toBe(2);
    expect(row.confirmedCount).toBe(1);
    expect(row.firstOpenBlockId).toBe(open.id);
    expect(row.openDecisions).toBe(1);
  });
});
