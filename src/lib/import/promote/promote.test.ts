import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { uploads, sheets, blocks, blockMappings } from '@/db/schema/source';
import { ledgerEntries, budgetLines, obligations } from '@/db/schema/money';
import { listMovements } from '@/lib/money/ledger';
import { listBudgetLines, budgetTotalAgorot } from '@/lib/money/budget';
import { listObligations } from '@/lib/money/obligations';
import { listUnlinkedNames } from '@/lib/members/identity';
import { setSheetSeason, setSheetAuthority } from '@/lib/import/sheets';
import type { ColumnMapping } from '@/lib/classify/map-columns';
import type { BlockArchetype } from '@/lib/classify/types';
import { promoteBlock } from './promote';

let db: TestDb;
let s26: string;
let sheetId: string;

const LEDGER_MAP: ColumnMapping[] = [
  { column: 1, field: 'date', confidence: 1 },
  { column: 2, field: 'description', confidence: 1 },
  { column: 3, field: 'outflow', confidence: 1 },
  { column: 4, field: 'inflow', confidence: 1 },
];

async function addSheet(filename: string, name: string): Promise<string> {
  const [up] = await db.insert(uploads).values({
    filename, sha256: `${filename}/${name}`, storageKey: `k/${name}`,
    sizeBytes: 1, uploadedBy: 'lead@shliff.test', status: 'committed',
  }).returning();
  const [sheet] = await db.insert(sheets).values({
    uploadId: up.id, name, index: 0, rowCount: 20, colCount: 6,
  }).returning();
  return sheet.id;
}

async function addBlock(
  onSheet: string, archetype: BlockArchetype, grid: string[][],
  columnMap: ColumnMapping[], opts: { confirmed?: boolean; top?: number } = {},
): Promise<string> {
  const top = opts.top ?? 1;
  const [block] = await db.insert(blocks).values({
    sheetId: onSheet, top, left: 1, bottom: top + grid.length - 1, right: 4,
    archetype, confidence: '1.0000', headerRow: top, fingerprint: null,
    pipelineVersion: 1, rawGrid: grid,
    confirmedBy: opts.confirmed === false ? null : 'lead@shliff.test',
    confirmedAt: opts.confirmed === false ? null : new Date(),
  }).returning();
  await db.insert(blockMappings).values({
    blockId: block.id, columnMap, source: 'admin',
  });
  return block.id;
}

beforeEach(async () => {
  db = await createTestDb();
  s26 = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35 })).id;
  sheetId = await addSheet('2026.xlsx', 'סיכום כללי');
  await setSheetSeason(db, sheetId, s26);
});

const LEDGER_GRID = [
  ['תאריך', 'פירוט', 'הוצאות', 'הכנסות'],
  ['20/05/2025', 'מקדמה מייצג', '4000', ''],
  ['30/10/2025', 'מסיבת פקאנים', '', '57000'],
  ['', 'מעבר לקובץ חדש', '', '44647'],
  ['', 'סה"כ', '4000', '101647'],
];

describe('promoteBlock — writing', () => {
  it('writes one row per promotable row and stamps provenance', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });

    expect(result.written).toHaveLength(2);
    expect(result.refused).toHaveLength(2);

    const rows = await db.select().from(ledgerEntries);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.sourceBlockId === blockId)).toBe(true);
    expect(rows.map((r) => r.sourceRow).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([2, 3]);
  });

  it('refuses the carry-forward and the total, each with its own reason', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(result.refused.map((r) => r.reason).sort())
      .toEqual(['carry-forward', 'total-row']);
  });

  it('a dry run writes nothing and returns no ids', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, { dryRun: true, recordedBy: 'lead@shliff.test' });

    expect(result.written).toHaveLength(2);
    expect(result.written.every((r) => r.id === null)).toBe(true);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });
});

describe('promoteBlock — idempotency', () => {
  it('running twice leaves the same rows, not duplicates', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });
    const first = await db.select().from(ledgerEntries);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });
    const second = await db.select().from(ledgerEntries);

    expect(second).toHaveLength(2);
    expect(second.map((r) => r.id).sort()).toEqual(first.map((r) => r.id).sort());
  });

  it('updates a row in place when the cell behind it changed', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });

    const changed = LEDGER_GRID.map((r) => [...r]);
    changed[1][2] = '4500';
    await db.update(blocks).set({ rawGrid: changed }).where(eq(blocks.id, blockId));
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });

    const moves = await listMovements(db, { seasonId: s26 });
    const row = moves.find((m) => m.description === 'מקדמה מייצג');
    expect(row?.amountAgorot).toBe(450000);
    expect(await db.select().from(ledgerEntries)).toHaveLength(2);
  });

  it('deletes a row the block no longer produces', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(await db.select().from(ledgerEntries)).toHaveLength(2);

    // The second data row becomes a total, so the block stops producing it.
    const changed = LEDGER_GRID.map((r) => [...r]);
    changed[2][1] = 'סה"כ';
    await db.update(blocks).set({ rawGrid: changed }).where(eq(blocks.id, blockId));
    const result = await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });

    expect(result.deleted).toBe(1);
    const rows = await db.select().from(ledgerEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceRow).toBe(2);
  });

  it('a dry run never deletes', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });
    const changed = LEDGER_GRID.map((r) => [...r]);
    changed[2][1] = 'סה"כ';
    await db.update(blocks).set({ rawGrid: changed }).where(eq(blocks.id, blockId));

    await promoteBlock(db, blockId, { dryRun: true, recordedBy: 'lead@shliff.test' });
    expect(await db.select().from(ledgerEntries)).toHaveLength(2);
  });
});

describe('promoteBlock — whole-block refusals', () => {
  it('refuses an unconfirmed block', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP, { confirmed: false });
    const result = await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(result.written).toHaveLength(0);
    expect(result.refused).toHaveLength(1);
  });

  it('refuses an archetype with no promoter in this wave', async () => {
    const blockId = await addBlock(sheetId, 'event_lines', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(result.refused[0].reason).toBe('no-promoter');
    expect(result.written).toHaveLength(0);
  });

  it('refuses every block on an undecided colliding sheet', async () => {
    const other = await addSheet('25.xlsx', 'סיכום כללי');
    await setSheetSeason(db, other, s26);
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(result.refused[0].reason).toBe('sheet-undecided');
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it('promotes once the colliding sheet has been resolved', async () => {
    const other = await addSheet('25.xlsx', 'סיכום כללי');
    await setSheetSeason(db, other, s26);
    await setSheetAuthority(db, sheetId, true);
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(result.written).toHaveLength(2);
  });

  it('refuses the superseded copy while the authoritative one promotes', async () => {
    const other = await addSheet('25.xlsx', 'סיכום כללי');
    await setSheetSeason(db, other, s26);
    await setSheetAuthority(db, sheetId, true);
    const losing = await addBlock(other, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, losing, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(result.refused[0].reason).toBe('sheet-superseded');
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it('does not double-count a budget when both copies of a sheet are confirmed', async () => {
    const a = await addSheet('25.xlsx', 'תקציב קאמפ ברן 26');
    const b = await addSheet('2026.xlsx', 'תקציב קאמפ ברן 26');
    await setSheetSeason(db, a, s26);
    await setSheetSeason(db, b, s26);

    const map: ColumnMapping[] = [
      { column: 1, field: 'item', confidence: 1 },
      { column: 2, field: 'quantity', confidence: 1 },
      { column: 3, field: 'unit_cost', confidence: 1 },
      { column: 4, field: 'total', confidence: 1 },
    ];
    const grid = [
      ['סוג הוצאה', 'כמות', 'מחיר', 'עלות כוללת'],
      ['בסיס', '1', '58523', '58523'],
    ];
    const ba = await addBlock(a, 'budget_lines', grid, map);
    const bb = await addBlock(b, 'budget_lines', grid, map);

    await promoteBlock(db, ba, { dryRun: false, recordedBy: 'lead@shliff.test' });
    await promoteBlock(db, bb, { dryRun: false, recordedBy: 'lead@shliff.test' });

    expect(await db.select().from(budgetLines)).toHaveLength(0);
    expect(await budgetTotalAgorot(db, s26)).toBe(0);
  });
});

describe('promoteBlock — party resolution', () => {
  const OBL_MAP: ColumnMapping[] = [
    { column: 1, field: 'party', confidence: 1 },
    { column: 2, field: 'description', confidence: 1 },
    { column: 3, field: 'amount', confidence: 1 },
    { column: 4, field: 'date', confidence: 1 },
  ];
  const OBL_GRID = [
    ['שם', 'פירוט', 'סכום', 'תאריך'],
    ['יוסף', 'חוב יוסף', '15240', '20/05/2025'],
    ['', 'החזר הוצאות', '480', '20/05/2025'],
  ];

  it('links a party when exactly one person matches exactly', async () => {
    await createPerson(db, 'יוסף', 'lead@shliff.test');
    const blockId = await addBlock(sheetId, 'obligations', OBL_GRID, OBL_MAP);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });

    const rows = await listObligations(db, { seasonId: s26 });
    const joseph = rows.find((r) => r.description === 'חוב יוסף');
    expect(joseph?.partyPersonId).not.toBeNull();
  });

  it('keeps the raw name and queues it when nobody matches', async () => {
    const blockId = await addBlock(sheetId, 'obligations', OBL_GRID, OBL_MAP);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });

    const rows = await listObligations(db, { seasonId: s26 });
    const joseph = rows.find((r) => r.description === 'חוב יוסף');
    expect(joseph?.partyPersonId).toBeNull();
    expect(joseph?.partyName).toBe('יוסף');
    expect((await listUnlinkedNames(db)).map((n) => n.alias)).toContain('יוסף');
  });

  it('keeps a nameless obligation and marks it unnamed', async () => {
    const blockId = await addBlock(sheetId, 'obligations', OBL_GRID, OBL_MAP);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });

    const rows = await listObligations(db, { seasonId: s26 });
    const nameless = rows.find((r) => r.description === 'החזר הוצאות');
    expect(nameless).toBeDefined();
    expect(nameless?.unnamed).toBe(true);
  });

  it('a dry run queues no unlinked names', async () => {
    const blockId = await addBlock(sheetId, 'obligations', OBL_GRID, OBL_MAP);
    await promoteBlock(db, blockId, { dryRun: true, recordedBy: 'lead@shliff.test' });
    expect(await listUnlinkedNames(db)).toHaveLength(0);
    expect(await db.select().from(obligations)).toHaveLength(0);
  });
});
