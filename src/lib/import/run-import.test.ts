import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { PgDatabase } from 'drizzle-orm/pg-core';
import { createTestDb, type TestDb } from '@/test/db';
import { uploads, sheets, blocks, blockMappings, layoutSignatures } from '@/db/schema/source';
import { budgetLines } from '@/db/schema/money';
import { runImport } from '@/lib/import/run-import';
import { applyConfirmation } from '@/lib/import/confirm';
import { promoteBlock } from '@/lib/import/promote/promote';
import { createSeason } from '@/lib/members/roster';
import { setSheetSeason } from '@/lib/import/sheets';
import { budgetTotalAgorot } from '@/lib/money/budget';
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

  it('propagates a previously confirmed budget category through a recognized repeat layout (Task 15 fix)', async () => {
    // Import the 25 file, then a lead confirms its budget block as the
    // dancefloor's — the real path (applyConfirmation), which stores the
    // category on both the mapping and the reusable signature.
    const firstId = await seedUpload(db, 'category-first'.padEnd(64, '0'));
    await runImport(db, firstId, fixtureBuffer(FIXTURES.y25));

    // Both fixtures share sheet names (same camp, consecutive years' copy of
    // the same template) — label the first upload's sheets into their own
    // season so they don't leave the second upload's same-named sheet stuck
    // 'undecided' (sheetEligibility treats a null-season sheet as an
    // unresolved duplicate of any same-named sheet, per `conflicts()` in
    // sheets.ts). Unrelated to the category propagation under test.
    const season25 = await createSeason(
      db, { name: 'ברן 25', year: 2025, flatRate: 1200, plannedSize: 35 },
    );
    const firstSheetIds = (await db.select().from(sheets)
      .where(eq(sheets.uploadId, firstId))).map((s) => s.id);
    for (const id of firstSheetIds) {
      await setSheetSeason(db, id, season25.id);
    }

    const budgetBlock = (await db.select().from(blocks))
      .find((b) => b.archetype === 'budget_lines' && b.fingerprint !== null);
    expect(budgetBlock).toBeDefined();
    const [firstMapping] = await db.select().from(blockMappings)
      .where(eq(blockMappings.blockId, budgetBlock!.id));

    await applyConfirmation(
      db, 'lead@shliff.test', budgetBlock!.id, 'budget_lines', firstMapping.columnMap, 'dancefloor',
    );

    // A second upload whose block shares the same fingerprint gets
    // auto-recognized — this is the path under test.
    const [second] = await db.insert(uploads).values({
      filename: FIXTURES.y26,
      sha256: 'category-second'.padEnd(64, '0'),
      storageKey: 'uploads/category-second.xlsx',
      sizeBytes: 22002,
      uploadedBy: 'admin@example.com',
    }).returning();
    const report = await runImport(db, second.id, fixtureBuffer(FIXTURES.y26));
    expect(report.autoRecognized).toBeGreaterThan(0);

    const secondSheetIds = (await db.select().from(sheets)
      .where(eq(sheets.uploadId, second.id))).map((s) => s.id);
    const recognizedBlock = (await db.select().from(blocks))
      .find((b) => secondSheetIds.includes(b.sheetId) && b.fingerprint === budgetBlock!.fingerprint);
    expect(recognizedBlock).toBeDefined();

    // The stored column: the new block's mapping must carry the lead's
    // decision, not silently re-default to camp.
    const [recognizedMapping] = await db.select().from(blockMappings)
      .where(eq(blockMappings.blockId, recognizedBlock!.id));
    expect(recognizedMapping.budgetCategory).toBe('dancefloor');

    // The promoted result: give the block the season and confirmed state a
    // lead's real confirm click on the pre-filled screen would produce.
    // Marked confirmed directly (not via a second applyConfirmation call)
    // so this test isolates run-import.ts's propagation from confirm.ts —
    // a second explicit category argument would decide the category again
    // and mask exactly the bug this test exists to catch.
    const season = await createSeason(
      db, { name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35 },
    );
    await setSheetSeason(db, recognizedBlock!.sheetId, season.id);
    await db.update(blocks)
      .set({ confirmedBy: 'lead@shliff.test', confirmedAt: new Date() })
      .where(eq(blocks.id, recognizedBlock!.id));

    const result = await promoteBlock(
      db, recognizedBlock!.id, { dryRun: false, recordedBy: 'lead@shliff.test' },
    );
    expect(result.written.length).toBeGreaterThan(0);

    const rows = await db.select().from(budgetLines)
      .where(eq(budgetLines.sourceBlockId, recognizedBlock!.id));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.category === 'dancefloor')).toBe(true);
    expect(await budgetTotalAgorot(db, season.id, 'camp')).toBe(0);
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

  it('rethrows the original error even when recording the failure also fails', async () => {
    const uploadId = await seedUpload(db, '2'.repeat(64));

    // Simulate the status-write itself failing (e.g. a dropped connection)
    // while the pipeline is already failing for an unrelated reason.
    const updateSpy = vi.spyOn(db, 'update').mockImplementation(() => {
      throw new Error('secondary write failure');
    });

    let caught: unknown;
    try {
      await runImport(db, uploadId, Buffer.from('not a workbook'));
    } catch (error) {
      caught = error;
    }
    updateSpy.mockRestore();

    // The original parsing failure must win, not the secondary write failure.
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toBe('secondary write failure');
  });

  it('rolls back all rows when a later sheet fails mid-import', async () => {
    const uploadId = await seedUpload(db, '3'.repeat(64));

    // `insert` lives once on the shared drizzle PgDatabase base class, so
    // spying on it there intercepts both the top-level db and any
    // transaction object created from it. Fail on the 3rd sheet insert
    // (the 2026 fixture has 5 sheets), after two sheets' worth of sheets
    // and blocks would already be written without a transaction.
    const originalInsert = PgDatabase.prototype.insert;
    let sheetInsertCount = 0;
    const insertSpy = vi.spyOn(PgDatabase.prototype, 'insert').mockImplementation(
      function (this: unknown, table: unknown) {
        if (table === sheets) {
          sheetInsertCount += 1;
          if (sheetInsertCount === 3) {
            throw new Error('simulated mid-import failure');
          }
        }
        return originalInsert.call(this as never, table as never);
      } as typeof PgDatabase.prototype.insert,
    );

    try {
      await expect(
        runImport(db, uploadId, fixtureBuffer(FIXTURES.y26)),
      ).rejects.toThrow('simulated mid-import failure');
    } finally {
      insertSpy.mockRestore();
    }

    expect(await db.select().from(sheets)).toHaveLength(0);
    expect(await db.select().from(blocks)).toHaveLength(0);
    const [row] = await db.select().from(uploads);
    expect(row.status).toBe('failed');
    expect(row.error).toBeTruthy();
  });

  /**
   * The upload route reuses a row that is not yet `parsed`, so `runImport` can
   * legitimately run twice for one `uploadId` — a retry after a failure, or two
   * near-simultaneous uploads of byte-identical content that both see it as
   * `pending`. It must replace what the previous run left, not append to it.
   */
  it('replaces a previous run rather than appending a second set of rows', async () => {
    const db = await createTestDb();
    const uploadId = await seedUpload(db, 'sha-rerun');

    await runImport(db, uploadId, fixtureBuffer(FIXTURES.y26));
    const firstSheets = await db.select().from(sheets);
    const firstBlocks = await db.select().from(blocks);
    expect(firstSheets.length).toBeGreaterThan(0);

    await runImport(db, uploadId, fixtureBuffer(FIXTURES.y26));

    expect(await db.select().from(sheets)).toHaveLength(firstSheets.length);
    expect(await db.select().from(blocks)).toHaveLength(firstBlocks.length);
  });

  it('clears stale error text when a retry succeeds', async () => {
    const db = await createTestDb();
    const uploadId = await seedUpload(db, 'sha-retry');
    await db.update(uploads)
      .set({ status: 'failed', error: 'קובץ פגום' })
      .where(eq(uploads.id, uploadId));

    await runImport(db, uploadId, fixtureBuffer(FIXTURES.y26));

    const [row] = await db.select().from(uploads);
    expect(row.status).toBe('parsed');
    expect(row.error).toBeNull();
  });
});
