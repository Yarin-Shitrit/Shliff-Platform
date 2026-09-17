import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { uploads, sheets, blocks, blockMappings } from '@/db/schema/source';
import { ledgerEntries, budgetLines, obligations } from '@/db/schema/money';
import { promoteBlock } from '@/lib/import/promote/promote';
import { settleObligation } from '@/lib/money/obligations';
import { setSheetSeason, setSheetAuthority } from '@/lib/import/sheets';
import type { ColumnMapping } from '@/lib/classify/map-columns';
import type { BlockArchetype } from '@/lib/classify/types';
import {
  worklist, coverage, collisionGroups, sheetsNeedingSeason, flaggedArithmetic,
} from './worklist';

let db: TestDb;
let s26: string;
let sheetId: string;

const LEAD = 'lead@shliff.test';

// -----------------------------------------------------------------------
// Fixtures — copied from src/lib/import/promote/promote.test.ts (Task 9
// brief: "duplicating them keeps each test file readable on its own").
// -----------------------------------------------------------------------

const LEDGER_MAP: ColumnMapping[] = [
  { column: 1, field: 'date', confidence: 1 },
  { column: 2, field: 'description', confidence: 1 },
  { column: 3, field: 'outflow', confidence: 1 },
  { column: 4, field: 'inflow', confidence: 1 },
];

const BUDGET_MAP: ColumnMapping[] = [
  { column: 1, field: 'item', confidence: 1 },
  { column: 2, field: 'quantity', confidence: 1 },
  { column: 3, field: 'unit_cost', confidence: 1 },
  { column: 4, field: 'total', confidence: 1 },
  { column: 5, field: 'note', confidence: 1 },
];

async function addSheet(filename: string, name: string): Promise<string> {
  const [up] = await db.insert(uploads).values({
    filename, sha256: `${filename}/${name}`, storageKey: `k/${name}`,
    sizeBytes: 1, uploadedBy: LEAD, status: 'committed',
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
    confirmedBy: opts.confirmed === false ? null : LEAD,
    confirmedAt: opts.confirmed === false ? null : new Date(),
  }).returning();
  await db.insert(blockMappings).values({
    blockId: block.id, columnMap, source: 'admin',
  });
  return block.id;
}

const LEDGER_GRID = [
  ['תאריך', 'פירוט', 'הוצאות', 'הכנסות'],
  ['20/05/2025', 'מקדמה מייצג', '4000', ''],
  ['30/10/2025', 'מסיבת פקאנים', '', '57000'],
  ['', 'מעבר לקובץ חדש', '', '44647'],
  ['', 'סה"כ', '4000', '101647'],
];

/** Three promotable rows and nothing else — no carry-forward, no total. */
const LEDGER_GRID_3 = [
  ['תאריך', 'פירוט', 'הוצאות', 'הכנסות'],
  ['20/05/2025', 'מקדמה מייצג', '4000', ''],
  ['30/10/2025', 'מסיבת פקאנים', '', '57000'],
  ['01/11/2025', 'עוד תנועה', '100', ''],
];

const OBL_MAP: ColumnMapping[] = [
  { column: 1, field: 'party', confidence: 1 },
  { column: 2, field: 'description', confidence: 1 },
  { column: 3, field: 'amount', confidence: 1 },
  { column: 4, field: 'date', confidence: 1 },
];
const OBL_GRID = [
  ['שם', 'פירוט', 'סכום', 'תאריך'],
  ['יוסף', 'חוב יוסף', '15240', '20/05/2025'],
];

beforeEach(async () => {
  db = await createTestDb();
  s26 = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35 })).id;
  sheetId = await addSheet('2026.xlsx', 'סיכום כללי');
  await setSheetSeason(db, sheetId, s26);
});

describe('worklist', () => {
  it('reports an unconfirmed block as unconfirmed with no refusals', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP, { confirmed: false });
    const rows = await worklist(db, LEAD);
    const row = rows.find((r) => r.blockId === blockId);

    expect(row).toBeDefined();
    expect(row?.state).toBe('unconfirmed');
    expect(row?.refusals).toEqual([]);
    expect(row?.rowCount).toBe(0);
    expect(row?.retained).toEqual([]);
    expect(row?.deleted).toBe(0);
  });

  it('reports a promoted block with its row count', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const rows = await worklist(db, LEAD);
    const row = rows.find((r) => r.blockId === blockId);

    expect(row).toBeDefined();
    expect(row?.state).toBe('promoted');
    expect(row?.rowCount).toBe(2);
    expect(row?.sheetId).toBe(sheetId);
    expect(row?.sheetName).toBe('סיכום כללי');
    expect(row?.filename).toBe('2026.xlsx');
    expect(row?.seasonId).toBe(s26);
    expect(row?.seasonName).toBe('ברן 26');
    expect(row?.archetype).toBe('ledger');
  });

  it('reports a parked archetype as no-promoter', async () => {
    const blockId = await addBlock(sheetId, 'event_lines', LEDGER_GRID, LEDGER_MAP);
    const rows = await worklist(db, LEAD);
    const row = rows.find((r) => r.blockId === blockId);

    expect(row?.state).toBe('no-promoter');
    expect(row?.rowCount).toBe(0);
    expect(row?.refusals).toHaveLength(1);
    expect(row?.refusals[0].reason).toBe('no-promoter');
  });

  it('reports a losing collision copy as superseded', async () => {
    const other = await addSheet('25.xlsx', 'סיכום כללי');
    await setSheetSeason(db, other, s26);
    await setSheetAuthority(db, sheetId, true);
    const losing = await addBlock(other, 'ledger', LEDGER_GRID, LEDGER_MAP);

    const rows = await worklist(db, LEAD);
    const row = rows.find((r) => r.blockId === losing);

    expect(row?.state).toBe('superseded');
    expect(row?.refusals).toHaveLength(1);
    expect(row?.refusals[0].reason).toBe('sheet-superseded');
  });

  it('reports a block on an undecided colliding sheet as refused', async () => {
    const other = await addSheet('25.xlsx', 'סיכום כללי');
    await setSheetSeason(db, other, s26);
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);

    const rows = await worklist(db, LEAD);
    const row = rows.find((r) => r.blockId === blockId);

    expect(row?.state).toBe('refused');
    expect(row?.refusals[0].reason).toBe('sheet-undecided');
  });

  it('carries each refusal reason through to the row', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const rows = await worklist(db, LEAD);
    const row = rows.find((r) => r.blockId === blockId);

    expect(row?.state).toBe('promoted');
    expect(row?.rowCount).toBe(2);
    expect(row?.refusals.map((r) => r.reason).sort()).toEqual(['carry-forward', 'total-row']);
  });

  it('never writes anything — the ledger is still empty afterwards', async () => {
    await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await worklist(db, LEAD);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it('carries a retained row through when a settlement depends on it', async () => {
    await createPerson(db, 'יוסף', LEAD);
    const blockId = await addBlock(sheetId, 'obligations', OBL_GRID, OBL_MAP);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: LEAD });
    const [joseph] = await db.select().from(obligations).where(eq(obligations.sourceRow, 2));
    await settleObligation(db, {
      obligationId: joseph.id, amount: 6000, kind: 'offset', note: 'קיזוז מול דמי קאמפ',
      settledOn: new Date(), recordedBy: LEAD,
    });

    // The obligation's row stops producing — the block's only row is blanked.
    await db.update(blocks).set({ rawGrid: [OBL_GRID[0], ['', '', '', '']] })
      .where(eq(blocks.id, blockId));

    const rows = await worklist(db, LEAD);
    const row = rows.find((r) => r.blockId === blockId);

    // The block's only row is retained, not deleted: the settlement depends
    // on it, so a dry run must not report it as gone.
    expect(row?.deleted).toBe(0);
    expect(row?.retained).toEqual([{
      table: 'obligations', id: joseph.id, sheetRow: 2, reason: expect.any(String),
    }]);
    expect(row?.retained[0].reason).not.toBe('');
    // Still a dry run: the obligation and its settlement are untouched.
    expect(await db.select().from(obligations)).toHaveLength(1);
  });
});

describe('coverage', () => {
  it('counts promoted rows per season and archetype', async () => {
    const other = await addSheet('2025b.xlsx', 'עוד גיליון');
    await setSheetSeason(db, other, s26);
    await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await addBlock(other, 'ledger', LEDGER_GRID_3, LEDGER_MAP);

    const rows = await worklist(db, LEAD);
    const cells = coverage(rows);
    const cell = cells.find((c) => c.seasonName === 'ברן 26' && c.archetype === 'ledger');

    expect(cell).toBeDefined();
    expect(cell?.promoted).toBe(5);
    expect(cell?.blocks).toBe(2);
  });

  it('shows a zero cell for a season with a confirmed but unpromoted block', async () => {
    await addBlock(sheetId, 'event_lines', LEDGER_GRID, LEDGER_MAP);

    const rows = await worklist(db, LEAD);
    const cells = coverage(rows);
    const cell = cells.find((c) => c.seasonName === 'ברן 26' && c.archetype === 'event_lines');

    expect(cell).toBeDefined();
    expect(cell?.promoted).toBe(0);
    expect(cell?.blocks).toBe(1);
  });
});

describe('collisionGroups', () => {
  it('groups two copies of one sheet name in one season', async () => {
    const other = await addSheet('25.xlsx', 'סיכום כללי');
    await setSheetSeason(db, other, s26);

    const groups = await collisionGroups(db);
    const group = groups.find((g) => g.name === 'סיכום כללי');

    expect(group).toBeDefined();
    expect(group?.sheets.map((s) => s.id).sort()).toEqual([sheetId, other].sort());
    expect(group?.state).toBe('undecided');
  });

  it('does not group two copies in different seasons', async () => {
    const s25 = (await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500, plannedSize: 43 })).id;
    const other = await addSheet('25.xlsx', 'סיכום כללי');
    await setSheetSeason(db, other, s25);

    const groups = await collisionGroups(db);
    expect(groups.find((g) => g.name === 'סיכום כללי')).toBeUndefined();
  });

  it('names a resolved collision by its loser, not its winner', async () => {
    const other = await addSheet('25.xlsx', 'סיכום כללי');
    await setSheetSeason(db, other, s26);
    await setSheetAuthority(db, sheetId, true);

    const groups = await collisionGroups(db);
    const group = groups.find((g) => g.name === 'סיכום כללי');

    expect(group?.sheets.map((s) => s.id).sort()).toEqual([sheetId, other].sort());
    expect(group?.state).toBe('superseded');
  });

  it('shows an ambiguous collision when both copies are marked authoritative', async () => {
    const other = await addSheet('25.xlsx', 'סיכום כללי');
    await setSheetSeason(db, other, s26);
    await setSheetAuthority(db, sheetId, true);
    await setSheetAuthority(db, other, true);

    const groups = await collisionGroups(db);
    const group = groups.find((g) => g.name === 'סיכום כללי');

    expect(group?.state).toBe('ambiguous');
  });
});

describe('sheetsNeedingSeason', () => {
  it('lists a sheet with no season set', async () => {
    const orphan = await addSheet('orphan.xlsx', 'גיליון יתום');
    const rows = await sheetsNeedingSeason(db);
    expect(rows.map((r) => r.id)).toContain(orphan);
  });

  it('excludes a sheet that already has a season', async () => {
    const rows = await sheetsNeedingSeason(db);
    expect(rows.map((r) => r.id)).not.toContain(sheetId);
  });
});

describe('flaggedArithmetic', () => {
  it('lists a budget line whose quantity × unit does not equal its total', async () => {
    const grid = [
      ['סוג הוצאה', 'כמות', 'מחיר', 'עלות כוללת', 'למה'],
      ['ציוד', '2', '100', '999', ''],
    ];
    const blockId = await addBlock(sheetId, 'budget_lines', grid, BUDGET_MAP);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: LEAD });

    const flagged = await flaggedArithmetic(db);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].seasonName).toBe('ברן 26');
    expect(flagged[0].line.label).toBe('ציוד');
    expect(flagged[0].line.arithmeticOff).toBe(true);
  });

  it('does not list a line with no quantity or no unit cost', async () => {
    const grid = [
      ['סוג הוצאה', 'כמות', 'מחיר', 'עלות כוללת', 'למה'],
      ['שמירה', '3', '', '300', ''],
    ];
    const blockId = await addBlock(sheetId, 'budget_lines', grid, BUDGET_MAP);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: LEAD });

    expect(await db.select().from(budgetLines)).toHaveLength(1);
    const flagged = await flaggedArithmetic(db);
    expect(flagged.map((f) => f.line.label)).not.toContain('שמירה');
  });
});
