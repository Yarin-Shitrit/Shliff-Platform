import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { uploads, sheets, blocks, blockMappings, layoutSignatures } from '@/db/schema/source';
import { budgetLines } from '@/db/schema/money';
import { applyConfirmation } from '@/lib/import/confirm';
import { promoteBlock } from '@/lib/import/promote/promote';
import { createSeason } from '@/lib/members/roster';
import { setSheetSeason } from '@/lib/import/sheets';
import type { ColumnMapping } from '@/lib/classify/map-columns';
import type { BlockArchetype } from '@/lib/classify/types';

async function seedBlock(db: TestDb, fingerprint: string | null, archetype: BlockArchetype = 'unknown') {
  const [upload] = await db.insert(uploads).values({
    filename: 'x.xlsx', sha256: 'a'.repeat(64), storageKey: 'k',
    sizeBytes: 1, uploadedBy: 'admin@example.com',
  }).returning();
  const [sheet] = await db.insert(sheets).values({
    uploadId: upload.id, name: 'סיכום כללי', index: 0, rowCount: 10, colCount: 4,
  }).returning();
  const [block] = await db.insert(blocks).values({
    sheetId: sheet.id, top: 1, left: 1, bottom: 5, right: 4,
    archetype, confidence: '0.1', headerRow: 1,
    fingerprint, pipelineVersion: 1, rawGrid: [['תאריך']],
  }).returning();
  await db.insert(blockMappings).values({
    blockId: block.id, columnMap: [], source: 'rules',
  });
  return block.id;
}

const LEDGER_MAP: ColumnMapping[] = [
  { column: 1, field: 'date', confidence: 1 },
  { column: 2, field: 'outflow', confidence: 1 },
  { column: 3, field: 'inflow', confidence: 1 },
];

const BUDGET_GRID = [
  ['סוג הוצאה', 'עלות כוללת'],
  ['בסיס', '58523'],
];

/** Seeds a block already stored (misclassified) as `ledger`, with a matching
 *  `ledger` column map, over the given grid — for exercising a re-pick to
 *  another archetype. */
async function seedLedgerBlock(db: TestDb, fingerprint: string | null, grid: string[][]) {
  const [upload] = await db.insert(uploads).values({
    filename: 'y.xlsx', sha256: 'b'.repeat(64), storageKey: 'k2',
    sizeBytes: 1, uploadedBy: 'admin@example.com',
  }).returning();
  const [sheet] = await db.insert(sheets).values({
    uploadId: upload.id, name: 'תקציב', index: 0,
    rowCount: grid.length, colCount: grid[0].length,
  }).returning();
  const [block] = await db.insert(blocks).values({
    sheetId: sheet.id, top: 1, left: 1, bottom: grid.length, right: grid[0].length,
    archetype: 'ledger', confidence: '0.9', headerRow: 1,
    fingerprint, pipelineVersion: 1, rawGrid: grid,
  }).returning();
  await db.insert(blockMappings).values({
    blockId: block.id, columnMap: LEDGER_MAP, source: 'rules',
  });
  return { blockId: block.id, sheetId: sheet.id };
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
    // Confirmed with the archetype it is already stored as, so the passed
    // map is used verbatim rather than recomputed — see the describe block
    // below for the archetype-changes-so-recompute behavior.
    const blockId = await seedBlock(db, 'f'.repeat(32), 'ledger');
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

describe('applyConfirmation — re-picking the archetype remaps the columns', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('a block stored as ledger, confirmed as budget_lines, ends up with budget fields and none of the ledger ones', async () => {
    const { blockId } = await seedLedgerBlock(db, 'd'.repeat(32), BUDGET_GRID);

    // The map handed in still speaks the archetype the block is leaving —
    // it must be discarded, not stored.
    await applyConfirmation(db, 'admin@example.com', blockId, 'budget_lines', LEDGER_MAP);

    const [mapping] = await db.select().from(blockMappings)
      .where(eq(blockMappings.blockId, blockId));
    const fields = mapping.columnMap.map((m) => m.field).sort();
    expect(fields).toEqual(['item', 'total']);
    expect(fields).not.toContain('date');
    expect(fields).not.toContain('outflow');
    expect(fields).not.toContain('inflow');
  });

  it('stores the recomputed map in the layout signature for that fingerprint too', async () => {
    const { blockId } = await seedLedgerBlock(db, 'd'.repeat(32), BUDGET_GRID);
    await applyConfirmation(db, 'admin@example.com', blockId, 'budget_lines', LEDGER_MAP);

    const [signature] = await db.select().from(layoutSignatures)
      .where(eq(layoutSignatures.fingerprint, 'd'.repeat(32)));
    expect(signature.archetype).toBe('budget_lines');
    expect(signature.columnMap.map((m) => m.field).sort()).toEqual(['item', 'total']);
  });

  it('confirming with an unchanged archetype stores the passed map verbatim, including an admin edit', async () => {
    const { blockId } = await seedLedgerBlock(db, 'd'.repeat(32), BUDGET_GRID);
    const edited: ColumnMapping[] = [{ column: 2, field: 'description', confidence: 1 }];

    await applyConfirmation(db, 'admin@example.com', blockId, 'ledger', edited);

    const [mapping] = await db.select().from(blockMappings)
      .where(eq(blockMappings.blockId, blockId));
    expect(mapping.columnMap).toEqual(edited);
  });

  it('promotes a re-picked block through its new archetype instead of refusing every row', async () => {
    const season = await createSeason(db, {
      name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35,
    });
    const { blockId, sheetId } = await seedLedgerBlock(db, null, BUDGET_GRID);
    await setSheetSeason(db, sheetId, season.id);

    await applyConfirmation(db, 'admin@example.com', blockId, 'budget_lines', LEDGER_MAP);
    const result = await promoteBlock(
      db, blockId, { dryRun: false, recordedBy: 'admin@example.com' },
    );

    expect(result.written).toHaveLength(1);
    expect(result.refused).toHaveLength(0);
    expect(await db.select().from(budgetLines)).toHaveLength(1);
  });
});
