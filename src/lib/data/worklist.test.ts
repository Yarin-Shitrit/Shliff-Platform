import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { uploads, sheets, blocks, blockMappings } from '@/db/schema/source';
import {
  ledgerEntries, budgetLines, ticketRounds, obligations,
} from '@/db/schema/money';
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

const BUDGET_GRID = [
  ['סוג הוצאה', 'כמות', 'מחיר', 'עלות כוללת', 'למה'],
  ['בסיס', '1', '58523', '58523', ''],
];

const TICKET_MAP: ColumnMapping[] = [
  { column: 1, field: 'round', confidence: 1 },
  { column: 2, field: 'quantity', confidence: 1 },
  { column: 3, field: 'price', confidence: 1 },
  { column: 4, field: 'total', confidence: 1 },
];
const TICKET_GRID = [
  ['סבב', 'כמות', 'מחיר', 'לסבב'],
  ['סבב א׳', '100', '150', '15000'],
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
    expect(row?.wouldWrite).toBe(0);
    expect(row?.retained).toEqual([]);
    expect(row?.deleted).toBe(0);
  });

  /**
   * This test used to be called "reports a promoted block with its row count"
   * and assert `state: 'promoted'`, `rowCount: 2` — on a block it never
   * promotes. The dry run says two rows WOULD be written; nobody has pressed
   * the button, and the ledger is empty. That is W17's
   * `confirmed-not-promoted`, and it is the state the register has to show a
   * lead who is deciding what still needs doing.
   */
  it('reports a confirmed block nobody has promoted as confirmed-not-promoted', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const rows = await worklist(db, LEAD);
    const row = rows.find((r) => r.blockId === blockId);

    expect(row).toBeDefined();
    expect(row?.state).toBe('confirmed-not-promoted');
    // Nothing exists; two rows would be written. The two numbers are separate
    // fields precisely because reporting the second as the first was the bug.
    expect(row?.rowCount).toBe(0);
    expect(row?.wouldWrite).toBe(2);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
    expect(row?.sheetId).toBe(sheetId);
    expect(row?.sheetName).toBe('סיכום כללי');
    expect(row?.filename).toBe('2026.xlsx');
    expect(row?.seasonId).toBe(s26);
    expect(row?.seasonName).toBe('ברן 26');
    expect(row?.archetype).toBe('ledger');
  });

  it('reports a block that really was promoted as promoted, with the rows that exist', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: LEAD });

    const rows = await worklist(db, LEAD);
    const row = rows.find((r) => r.blockId === blockId);

    expect(row?.state).toBe('promoted');
    expect(row?.rowCount).toBe(2);
    expect(row?.wouldWrite).toBe(2);
    expect(await db.select().from(ledgerEntries)).toHaveLength(2);
  });

  /** The same block, promoted and not promoted, must not read the same. This
   *  is the pair the old collapse made indistinguishable. */
  it('gives a promoted and an unpromoted copy of one grid different states', async () => {
    const other = await addSheet('2026b.xlsx', 'גיליון שני');
    await setSheetSeason(db, other, s26);
    const promoted = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const untouched = await addBlock(other, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, promoted, { dryRun: false, recordedBy: LEAD });

    const rows = await worklist(db, LEAD);
    expect(rows.find((r) => r.blockId === promoted)?.state).toBe('promoted');
    expect(rows.find((r) => r.blockId === untouched)?.state).toBe('confirmed-not-promoted');
    expect(rows.find((r) => r.blockId === promoted)?.rowCount).toBe(2);
    expect(rows.find((r) => r.blockId === untouched)?.rowCount).toBe(0);
  });

  /**
   * W11, and the third consequence of deciding the state from the dry run
   * alone. A budget block on a season-less sheet emits one `no-season`
   * refusal PER ROW, so `refused.length` is 2 rather than 1, so the
   * whole-block branch is not taken — and the block used to read `promoted`
   * with `rowCount: 0`: promoted, having written nothing, with a reason on
   * every row. W11 says plainly that such a block is refused.
   */
  it('reports a season-less budget block as refused, not promoted with zero rows', async () => {
    const orphan = await addSheet('orphan.xlsx', 'תקציב בלי עונה');
    const blockId = await addBlock(orphan, 'budget_lines', [
      ['סוג הוצאה', 'כמות', 'מחיר', 'עלות כוללת', 'למה'],
      ['בסיס', '1', '58523', '58523', ''],
      ['אוכל', '1', '5000', '5000', ''],
    ], BUDGET_MAP);

    const rows = await worklist(db, LEAD);
    const row = rows.find((r) => r.blockId === blockId);

    expect(row?.state).toBe('refused');
    expect(row?.rowCount).toBe(0);
    expect(row?.wouldWrite).toBe(0);
    // One reason per row, which is why the whole-block branch cannot catch it.
    expect(row?.refusals).toHaveLength(2);
    expect(row?.refusals.map((r) => r.reason)).toEqual(['no-season', 'no-season']);
  });

  it('reports a season-less ticket block as refused too', async () => {
    const orphan = await addSheet('orphan2.xlsx', 'כרטיסים בלי עונה');
    const blockId = await addBlock(orphan, 'ticket_rounds', [
      ['סבב', 'כמות', 'מחיר', 'לסבב'],
      ['סבב א׳', '100', '150', '15000'],
      ['סבב ב׳', '200', '150', '30000'],
    ], TICKET_MAP);

    const rows = await worklist(db, LEAD);
    const row = rows.find((r) => r.blockId === blockId);

    expect(row?.state).toBe('refused');
    expect(row?.refusals.map((r) => r.reason)).toEqual(['no-season', 'no-season']);
  });

  it('reports a parked archetype as no-promoter', async () => {
    const blockId = await addBlock(sheetId, 'event_lines', LEDGER_GRID, LEDGER_MAP);
    const rows = await worklist(db, LEAD);
    const row = rows.find((r) => r.blockId === blockId);

    expect(row?.state).toBe('no-promoter');
    expect(row?.rowCount).toBe(0);
    expect(row?.wouldWrite).toBe(0);
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

  /**
   * A per-row refusal never overrides a block that would write something —
   * `carry-forward` and `total-row` here sit beside two promotable rows. The
   * block IS promoted, so it is really promoted first; the assertions on the
   * unpromoted case live in `confirmed-not-promoted` above.
   */
  it('carries each refusal reason through to the row', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: LEAD });

    const rows = await worklist(db, LEAD);
    const row = rows.find((r) => r.blockId === blockId);

    expect(row?.state).toBe('promoted');
    expect(row?.rowCount).toBe(2);
    expect(row?.wouldWrite).toBe(2);
    expect(row?.refusals.map((r) => r.reason).sort()).toEqual(['carry-forward', 'total-row']);
  });

  it('never writes anything — every promotable table is still empty afterwards', async () => {
    await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await addBlock(sheetId, 'budget_lines', BUDGET_GRID, BUDGET_MAP, { top: 20 });
    await addBlock(sheetId, 'ticket_rounds', TICKET_GRID, TICKET_MAP, { top: 30 });
    await worklist(db, LEAD);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
    expect(await db.select().from(budgetLines)).toHaveLength(0);
    expect(await db.select().from(ticketRounds)).toHaveLength(0);
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
  /**
   * This test used to be called "counts promoted rows per season and
   * archetype" and assert `promoted: 5` for two blocks it never promotes.
   * W18's matrix would have told a lead the ברן 26 ledger was covered by five
   * rows before the promote button had ever been pressed. Both blocks are
   * counted (`blocks: 2`, Ruling R24) and neither contributes a promoted row.
   */
  it('counts no promoted rows for two blocks nobody has promoted', async () => {
    const other = await addSheet('2025b.xlsx', 'עוד גיליון');
    await setSheetSeason(db, other, s26);
    await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await addBlock(other, 'ledger', LEDGER_GRID_3, LEDGER_MAP);

    const rows = await worklist(db, LEAD);
    const cells = coverage(rows);
    const cell = cells.find((c) => c.seasonName === 'ברן 26' && c.archetype === 'ledger');

    expect(cell).toBeDefined();
    expect(cell?.promoted).toBe(0);
    expect(cell?.blocks).toBe(2);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
    // The would-write total is still available, on the rows, under its own name.
    expect(rows.reduce((n, r) => n + r.wouldWrite, 0)).toBe(5);
  });

  it('counts rows that exist once the blocks really are promoted', async () => {
    const other = await addSheet('2025b.xlsx', 'עוד גיליון');
    await setSheetSeason(db, other, s26);
    const first = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const second = await addBlock(other, 'ledger', LEDGER_GRID_3, LEDGER_MAP);
    await promoteBlock(db, first, { dryRun: false, recordedBy: LEAD });
    await promoteBlock(db, second, { dryRun: false, recordedBy: LEAD });

    const cells = coverage(await worklist(db, LEAD));
    const cell = cells.find((c) => c.seasonName === 'ברן 26' && c.archetype === 'ledger');

    expect(cell?.promoted).toBe(5);
    expect(cell?.blocks).toBe(2);
    expect(await db.select().from(ledgerEntries)).toHaveLength(5);
  });

  it('counts only the block that was promoted when its neighbour was not', async () => {
    const other = await addSheet('2025b.xlsx', 'עוד גיליון');
    await setSheetSeason(db, other, s26);
    const first = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await addBlock(other, 'ledger', LEDGER_GRID_3, LEDGER_MAP);
    await promoteBlock(db, first, { dryRun: false, recordedBy: LEAD });

    const cells = coverage(await worklist(db, LEAD));
    const cell = cells.find((c) => c.seasonName === 'ברן 26' && c.archetype === 'ledger');

    expect(cell?.promoted).toBe(2);
    expect(cell?.blocks).toBe(2);
  });

  it('counts rows of every target table, not only the ledger', async () => {
    const budget = await addBlock(sheetId, 'budget_lines', BUDGET_GRID, BUDGET_MAP, { top: 20 });
    const tickets = await addBlock(sheetId, 'ticket_rounds', TICKET_GRID, TICKET_MAP, { top: 30 });
    await promoteBlock(db, budget, { dryRun: false, recordedBy: LEAD });
    await promoteBlock(db, tickets, { dryRun: false, recordedBy: LEAD });

    const cells = coverage(await worklist(db, LEAD));
    expect(cells.find((c) => c.archetype === 'budget_lines')?.promoted).toBe(1);
    expect(cells.find((c) => c.archetype === 'ticket_rounds')?.promoted).toBe(1);
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

  it('counts an unconfirmed block into its cell without counting it toward promoted', async () => {
    await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP, { confirmed: false });

    const rows = await worklist(db, LEAD);
    const cells = coverage(rows);
    const cell = cells.find((c) => c.seasonName === 'ברן 26' && c.archetype === 'ledger');

    // The register's job is "what has not settled yet": a cell holding an
    // unconfirmed table and nothing promoted must still show the block, not
    // read as an empty cell that implies there is nothing to do.
    expect(cell).toBeDefined();
    expect(cell?.blocks).toBe(1);
    expect(cell?.promoted).toBe(0);
  });

  /**
   * Rows that exist are counted whatever label this module puts on their
   * block. A block promoted and then un-confirmed still has its rows in the
   * season's money, and a matrix that read zero there would understate
   * coverage as badly as the old code overstated it.
   */
  it('still counts the rows of a block that was promoted and then un-confirmed', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: LEAD });
    await db.update(blocks).set({ confirmedAt: null, confirmedBy: null })
      .where(eq(blocks.id, blockId));

    const rows = await worklist(db, LEAD);
    const row = rows.find((r) => r.blockId === blockId);
    expect(row?.state).toBe('unconfirmed');
    expect(row?.rowCount).toBe(2);

    const cells = coverage(rows);
    expect(cells.find((c) => c.archetype === 'ledger')?.promoted).toBe(2);
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

  it('keeps a group to only the sheets in its own season, even with a third same-named sheet elsewhere', async () => {
    const other = await addSheet('25.xlsx', 'סיכום כללי');
    await setSheetSeason(db, other, s26);
    const s27 = (await createSeason(db, { name: 'ברן 27', year: 2027, flatRate: 1300, plannedSize: 30 })).id;
    const third = await addSheet('27.xlsx', 'סיכום כללי');
    await setSheetSeason(db, third, s27);

    const groups = await collisionGroups(db);
    const group = groups.find((g) => g.name === 'סיכום כללי');

    expect(group).toBeDefined();
    expect(group?.sheets.map((s) => s.id).sort()).toEqual([sheetId, other].sort());
    expect(group?.sheets.map((s) => s.id)).not.toContain(third);
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
