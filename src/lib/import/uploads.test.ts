import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { uploads, sheets, blocks, blockMappings } from '@/db/schema/source';
import { seasons } from '@/db/schema/camp';
import { listUploads, uploadStatusLabel, findUpload } from './uploads';

const LEAD = 'lead@shliff.test';

/**
 * Every case here now states `seasonBlockedCount`, because A36 made it part of
 * the question the label answers: "is this file ready" cannot be answered from
 * the table count alone. The four cases that predate A36 state it as 0 — that
 * is what they always meant, and saying so is what keeps them honest now that
 * a non-zero value changes the answer.
 */
describe('uploadStatusLabel', () => {
  it('says a failed parse failed', () => {
    expect(uploadStatusLabel({
      status: 'failed', blockCount: 0, confirmedCount: 0, promotedRows: 0,
      seasonBlockedCount: 0,
    })).toEqual({ text: 'נכשל', tone: 'bad' });
  });

  it('says so when a workbook parsed but held no table', () => {
    expect(uploadStatusLabel({
      status: 'parsed', blockCount: 0, confirmedCount: 0, promotedRows: 0,
      seasonBlockedCount: 0,
    })).toEqual({ text: 'לא נמצאו טבלאות', tone: 'warn' });
  });

  it('counts what is left rather than what is done', () => {
    expect(uploadStatusLabel({
      status: 'parsed', blockCount: 11, confirmedCount: 3, promotedRows: 0,
      seasonBlockedCount: 0,
    })).toEqual({ text: '8 לבדיקה', tone: 'brand' });
  });

  /** Re-aimed, not removed: with every sheet labelled, "ready" is still the
   *  true word, and this is now the case that says so explicitly. */
  it('says a fully confirmed file whose seasons are set is ready, not finished', () => {
    expect(uploadStatusLabel({
      status: 'parsed', blockCount: 11, confirmedCount: 11, promotedRows: 0,
      seasonBlockedCount: 0,
    })).toEqual({ text: 'מוכן לקידום', tone: 'brand' });
  });

  it('calls a file promoted only when rows exist, never on the status column', () => {
    expect(uploadStatusLabel({
      status: 'parsed', blockCount: 11, confirmedCount: 11, promotedRows: 52,
      seasonBlockedCount: 0,
    })).toEqual({ text: 'הוקדם', tone: 'ok' });
    expect(uploadStatusLabel({
      status: 'committed', blockCount: 11, confirmedCount: 11, promotedRows: 0,
      seasonBlockedCount: 0,
    })).toEqual({ text: 'מוכן לקידום', tone: 'brand' });
  });

  /**
   * A36. Confirmation is a statement about tables; a season is a statement
   * about sheets. A file of approved budget tables on season-less sheets would
   * refuse every row it holds, so "מוכן לקידום" is a promise it cannot keep.
   */
  it('names the open season decision instead of promising a promotion', () => {
    expect(uploadStatusLabel({
      status: 'parsed', blockCount: 10, confirmedCount: 10, promotedRows: 0,
      seasonBlockedCount: 8,
    })).toEqual({ text: 'ממתין לקביעת עונה', tone: 'warn' });
  });

  it('keeps the season decision on the pill after a partial promotion', () => {
    expect(uploadStatusLabel({
      status: 'parsed', blockCount: 10, confirmedCount: 10, promotedRows: 31,
      seasonBlockedCount: 6,
    })).toEqual({ text: 'ממתין לקביעת עונה', tone: 'warn' });
  });

  it('counts what is left to review before it names the season decision', () => {
    expect(uploadStatusLabel({
      status: 'parsed', blockCount: 10, confirmedCount: 2, promotedRows: 0,
      seasonBlockedCount: 6,
    })).toEqual({ text: '8 לבדיקה', tone: 'brand' });
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

  /**
   * A36, measured against a real database rather than asserted about a shape:
   * the budget table is approved, its sheet carries no season, and the promoter
   * would refuse every one of its rows with `no-season`.
   */
  it('counts an approved budget table on a season-less sheet as blocked on the season', async () => {
    const [upload] = await db.insert(uploads).values({
      filename: "קופת קאמפ 23'-24'.xlsx", sha256: 'e'.repeat(64), storageKey: 'k',
      // `status` defaults to `pending`, which the label reports as בעיבוד
      // before it looks at anything else. A parsed file is what this is about.
      sizeBytes: 1, uploadedBy: LEAD, status: 'parsed',
    }).returning();
    const [sheet] = await db.insert(sheets).values({
      uploadId: upload.id, name: 'תקציב', index: 0, rowCount: 9, colCount: 4,
    }).returning();
    const [block] = await db.insert(blocks).values({
      sheetId: sheet.id, top: 1, left: 1, bottom: 8, right: 4,
      archetype: 'budget_lines', confidence: '0.9000', headerRow: 1,
      fingerprint: null, pipelineVersion: 1, rawGrid: [['סעיף']],
      confirmedBy: LEAD, confirmedAt: new Date(),
    }).returning();
    await db.insert(blockMappings).values({
      blockId: block.id, columnMap: [{ column: 1, field: 'item', confidence: 1 }],
      source: 'admin',
    });

    const [row] = await listUploads(db);
    expect(row.confirmedCount).toBe(row.blockCount);
    expect(row.seasonBlockedCount).toBe(1);
    expect(uploadStatusLabel(row)).toEqual({ text: 'ממתין לקביעת עונה', tone: 'warn' });
  });

  /**
   * The negative case, and the reason the rule reads the archetype rather than
   * the sheet alone: `ledger_entries.season_id` is nullable and `ledgerRow`
   * carries a season only when there is one, so a season-less ledger sheet
   * promotes in full. A rule that fired here would fire on everything.
   */
  it('leaves a ledger table on a season-less sheet ready: the ledger needs no season', async () => {
    const [upload] = await db.insert(uploads).values({
      filename: 'תנועות.xlsx', sha256: 'f'.repeat(64), storageKey: 'k',
      sizeBytes: 1, uploadedBy: LEAD, status: 'parsed',
    }).returning();
    const [sheet] = await db.insert(sheets).values({
      uploadId: upload.id, name: 'תנועות', index: 0, rowCount: 9, colCount: 4,
    }).returning();
    const [block] = await db.insert(blocks).values({
      sheetId: sheet.id, top: 1, left: 1, bottom: 8, right: 4,
      archetype: 'ledger', confidence: '0.9000', headerRow: 1,
      fingerprint: null, pipelineVersion: 1, rawGrid: [['תאריך']],
      confirmedBy: LEAD, confirmedAt: new Date(),
    }).returning();
    await db.insert(blockMappings).values({
      blockId: block.id, columnMap: [{ column: 1, field: 'date', confidence: 1 }],
      source: 'admin',
    });

    const [row] = await listUploads(db);
    expect(row.seasonBlockedCount).toBe(0);
    expect(uploadStatusLabel(row)).toEqual({ text: 'מוכן לקידום', tone: 'brand' });
  });
});

/**
 * The review screen's own header row. It exists so that `imports/[id]/page.tsx`
 * spells no query of its own: every other admin page in this repo reaches the
 * database through a library function, which is what lets the page be tested
 * against a `db` that is an empty object.
 */
describe('findUpload', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('answers with the file it was asked for', async () => {
    const [wanted] = await db.insert(uploads).values({
      filename: 'קופת קאמפ 2026.xlsx', sha256: 'a'.repeat(64), storageKey: 'k1',
      sizeBytes: 1, uploadedBy: 'שירה',
    }).returning();
    await db.insert(uploads).values({
      filename: 'אחר.xlsx', sha256: 'b'.repeat(64), storageKey: 'k2',
      sizeBytes: 1, uploadedBy: LEAD,
    });

    const row = await findUpload(db, wanted.id);
    expect(row?.filename).toBe('קופת קאמפ 2026.xlsx');
    expect(row?.uploadedBy).toBe('שירה');
    expect(row?.status).toBe('pending');
  });

  it('answers null for an id no file carries, rather than throwing', async () => {
    expect(await findUpload(db, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});
