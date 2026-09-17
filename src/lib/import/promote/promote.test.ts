import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { uploads, sheets, blocks, blockMappings } from '@/db/schema/source';
import { campEvents } from '@/db/schema/camp';
import {
  accounts, ledgerEntries, budgetLines, ticketRounds, obligations, obligationSettlements,
} from '@/db/schema/money';
import { listMovements, recordEntry } from '@/lib/money/ledger';
import { listBudgetLines, budgetTotalAgorot } from '@/lib/money/budget';
import { listObligations, createObligation, settleObligation } from '@/lib/money/obligations';
import { createTask } from '@/lib/work/tasks';
import { listUnlinkedNames } from '@/lib/members/identity';
import { setSheetSeason, setSheetAuthority } from '@/lib/import/sheets';
import type { ColumnMapping } from '@/lib/classify/map-columns';
import type { BlockArchetype } from '@/lib/classify/types';
import { promoteBlock, promoteAll } from './promote';

let db: TestDb;
let s26: string;
let sheetId: string;

const LEAD = { dryRun: false, recordedBy: 'lead@shliff.test' };
const DRY = { dryRun: true, recordedBy: 'lead@shliff.test' };

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

/** What a lead re-confirming a block as something else leaves behind. Written
 *  against the tables directly so this file does not depend on how
 *  `applyConfirmation` evolves. */
async function reconfirm(
  blockId: string, archetype: BlockArchetype, grid: string[][], columnMap: ColumnMapping[],
): Promise<void> {
  await db.update(blocks).set({ archetype, rawGrid: grid }).where(eq(blocks.id, blockId));
  await db.update(blockMappings).set({ columnMap }).where(eq(blockMappings.blockId, blockId));
}

async function setGrid(blockId: string, grid: string[][]): Promise<void> {
  await db.update(blocks).set({ rawGrid: grid }).where(eq(blocks.id, blockId));
}

function copy(grid: string[][]): string[][] {
  return grid.map((r) => [...r]);
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

/** Three promotable rows and nothing else, so a test can turn one into a
 *  total and still have two left to write. */
const LEDGER_GRID_3 = [
  ['תאריך', 'פירוט', 'הוצאות', 'הכנסות'],
  ['20/05/2025', 'מקדמה מייצג', '4000', ''],
  ['30/10/2025', 'מסיבת פקאנים', '', '57000'],
  ['01/11/2025', 'עוד תנועה', '100', ''],
];

describe('promoteBlock — writing', () => {
  it('writes one row per promotable row and stamps provenance', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, LEAD);

    expect(result.written).toHaveLength(2);
    expect(result.refused).toHaveLength(2);

    const rows = await db.select().from(ledgerEntries);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.sourceBlockId === blockId)).toBe(true);
    expect(rows.map((r) => r.sourceRow).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([2, 3]);
  });

  it('refuses the carry-forward and the total, each with its own reason', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, LEAD);
    expect(result.refused.map((r) => r.reason).sort())
      .toEqual(['carry-forward', 'total-row']);
  });

  it('a dry run writes nothing and returns no ids', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, DRY);

    expect(result.written).toHaveLength(2);
    expect(result.written.every((r) => r.id === null)).toBe(true);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it('stores every field of a ledger row, and names no account, event or budget line (W9)', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, LEAD);

    const rows = await db.select().from(ledgerEntries).orderBy(asc(ledgerEntries.sourceRow));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      direction: 'out',
      amount: '4000.00',
      description: 'מקדמה מייצג',
      seasonId: s26,
      recordedBy: 'lead@shliff.test',
      accountId: null,
      eventId: null,
      budgetLineId: null,
      transferGroupId: null,
      sourceBlockId: blockId,
      sourceRow: 2,
    });
    expect(rows[0].occurredOn.toISOString()).toBe('2025-05-20T00:00:00.000Z');
    expect(rows[1]).toMatchObject({
      direction: 'in', amount: '57000.00', description: 'מסיבת פקאנים', sourceRow: 3,
    });
    expect(rows[1].occurredOn.toISOString()).toBe('2025-10-30T00:00:00.000Z');
  });

  it('stores every field of a budget line', async () => {
    const grid = [
      ['סוג הוצאה', 'כמות', 'מחיר', 'עלות כוללת', 'למה'],
      ['גנרטור', '12,000kw', '0.333', '3996.1', 'תוספת של 1,000'],
      ['אוכל', 'תפריט שלם לשבוע', '', '5000', ''],
    ];
    const blockId = await addBlock(sheetId, 'budget_lines', grid, BUDGET_MAP);
    await promoteBlock(db, blockId, LEAD);

    const rows = await db.select().from(budgetLines).orderBy(asc(budgetLines.sourceRow));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: expect.any(String),
      seasonId: s26,
      label: 'גנרטור',
      quantityText: '12,000kw',
      quantityNum: '12000.00',
      unitCost: '0.33',
      total: '3996.10',
      rationale: 'תוספת של 1,000',
      category: 'camp',
      sourceBlockId: blockId,
      sourceRow: 2,
    });
    expect(rows[1]).toEqual({
      id: expect.any(String),
      seasonId: s26,
      label: 'אוכל',
      quantityText: 'תפריט שלם לשבוע',
      quantityNum: null,
      unitCost: null,
      total: '5000.00',
      rationale: null,
      category: 'camp',
      sourceBlockId: blockId,
      sourceRow: 3,
    });

    const listed = await listBudgetLines(db, s26);
    expect(listed.map((l) => [l.label, l.totalAgorot, l.unitCostAgorot])).toEqual([
      ['אוכל', 500000, null],
      ['גנרטור', 399610, 33],
    ]);
  });

  it('stores every field of a ticket round', async () => {
    const grid = [
      ['סבב', 'כמות', 'מחיר', 'לסבב'],
      ['סבב ג׳', '165', '200.5', '33082.5'],
    ];
    const blockId = await addBlock(sheetId, 'ticket_rounds', grid, TICKET_MAP);
    await promoteBlock(db, blockId, LEAD);

    const rows = await db.select().from(ticketRounds);
    expect(rows).toEqual([{
      id: expect.any(String),
      seasonId: s26,
      eventId: null,
      label: 'סבב ג׳',
      quantity: 165,
      price: '200.50',
      total: '33082.50',
      sold: false,
      sourceBlockId: blockId,
      sourceRow: 2,
    }]);
  });

  it('stores every field of an obligation, at its absolute sheet row', async () => {
    const personId = await createPerson(db, 'יוסף', 'lead@shliff.test');
    const blockId = await addBlock(sheetId, 'obligations', OBL_GRID, OBL_MAP, { top: 5 });
    await promoteBlock(db, blockId, LEAD);

    const rows = await db.select().from(obligations).orderBy(asc(obligations.sourceRow));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: expect.any(String),
      direction: 'camp_owes',
      partyPersonId: personId,
      partyName: null,
      description: 'חוב יוסף',
      amount: '15240.00',
      seasonId: s26,
      openedOn: new Date('2025-05-20T00:00:00.000Z'),
      sourceBlockId: blockId,
      sourceRow: 6,
    });
    expect(rows[1]).toMatchObject({
      direction: 'camp_owes',
      partyPersonId: null,
      partyName: null,
      description: 'החזר הוצאות',
      amount: '480.00',
      seasonId: s26,
      sourceBlockId: blockId,
      sourceRow: 7,
    });
  });

  it('promotes both סיכום כללי sheets when they are labelled to different seasons (W12)', async () => {
    const s25 = (await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500, plannedSize: 43 })).id;
    const other = await addSheet('25.xlsx', 'סיכום כללי');
    await setSheetSeason(db, other, s25);
    const a = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const b = await addBlock(other, 'ledger', LEDGER_GRID, LEDGER_MAP);

    const ra = await promoteBlock(db, a, LEAD);
    const rb = await promoteBlock(db, b, LEAD);

    expect(ra.refused.map((r) => r.reason)).not.toContain('sheet-undecided');
    expect(ra.written).toHaveLength(2);
    expect(rb.written).toHaveLength(2);
    expect(await listMovements(db, { seasonId: s26 })).toHaveLength(2);
    expect(await listMovements(db, { seasonId: s25 })).toHaveLength(2);
  });
});

describe('promoteBlock — idempotency', () => {
  it('running twice leaves the same rows, not duplicates', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, LEAD);
    const first = await db.select().from(ledgerEntries);
    await promoteBlock(db, blockId, LEAD);
    const second = await db.select().from(ledgerEntries);

    expect(second).toHaveLength(2);
    expect(second.map((r) => r.id).sort()).toEqual(first.map((r) => r.id).sort());
  });

  it('updates a row in place when the cell behind it changed', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, LEAD);

    const changed = copy(LEDGER_GRID);
    changed[1][2] = '4500';
    await setGrid(blockId, changed);
    await promoteBlock(db, blockId, LEAD);

    const moves = await listMovements(db, { seasonId: s26 });
    const row = moves.find((m) => m.description === 'מקדמה מייצג');
    expect(row?.amountAgorot).toBe(450000);
    expect(await db.select().from(ledgerEntries)).toHaveLength(2);
  });

  it('deletes a row the block no longer produces', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, LEAD);
    expect(await db.select().from(ledgerEntries)).toHaveLength(2);

    // The second data row becomes a total, so the block stops producing it.
    const changed = copy(LEDGER_GRID);
    changed[2][1] = 'סה"כ';
    await setGrid(blockId, changed);
    const result = await promoteBlock(db, blockId, LEAD);

    expect(result.deleted).toBe(1);
    expect(result.retained).toEqual([]);
    const rows = await db.select().from(ledgerEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceRow).toBe(2);
  });

  it('a dry run never deletes, but reports what a commit would delete', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, LEAD);
    const changed = copy(LEDGER_GRID);
    changed[2][1] = 'סה"כ';
    await setGrid(blockId, changed);

    const dry = await promoteBlock(db, blockId, DRY);
    expect(dry.deleted).toBe(1);
    expect(await db.select().from(ledgerEntries)).toHaveLength(2);
  });

  it('a re-run keeps a hand-set ledger account and budget category', async () => {
    const ledgerBlock = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const budgetBlock = await addBlock(sheetId, 'budget_lines', BUDGET_GRID, BUDGET_MAP, { top: 20 });
    await promoteBlock(db, ledgerBlock, LEAD);
    await promoteBlock(db, budgetBlock, LEAD);

    const [account] = await db.insert(accounts).values({ name: 'קופה', kind: 'cash' }).returning();
    await db.update(ledgerEntries).set({ accountId: account.id })
      .where(eq(ledgerEntries.sourceRow, 2));
    await db.update(budgetLines).set({ category: 'dancefloor' })
      .where(eq(budgetLines.sourceBlockId, budgetBlock));

    await promoteBlock(db, ledgerBlock, LEAD);
    await promoteBlock(db, budgetBlock, LEAD);

    const [entry] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.sourceRow, 2));
    const [line] = await db.select().from(budgetLines);
    expect(entry.accountId).toBe(account.id);
    expect(line.category).toBe('dancefloor');
  });

  it('a re-run keeps every other decision made after import', async () => {
    const ledgerBlock = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const budgetBlock = await addBlock(sheetId, 'budget_lines', BUDGET_GRID, BUDGET_MAP, { top: 20 });
    const ticketGrid = [['סבב', 'כמות', 'מחיר', 'לסבב'], ['סבב א׳', '100', '150', '15000']];
    const ticketBlock = await addBlock(sheetId, 'ticket_rounds', ticketGrid, TICKET_MAP, { top: 30 });
    await promoteBlock(db, ledgerBlock, LEAD);
    await promoteBlock(db, budgetBlock, LEAD);
    await promoteBlock(db, ticketBlock, LEAD);

    const [event] = await db.insert(campEvents)
      .values({ seasonId: s26, name: 'מסיבת פקאנים', kind: 'fundraiser' }).returning();
    const [line] = await db.select().from(budgetLines);
    const group = randomUUID();
    await db.update(ledgerEntries).set({
      eventId: event.id, budgetLineId: line.id, transferGroupId: group,
    }).where(eq(ledgerEntries.sourceRow, 3));
    await db.update(ticketRounds).set({ eventId: event.id, sold: true });

    const other = { dryRun: false, recordedBy: 'other@shliff.test' };
    await promoteBlock(db, ledgerBlock, other);
    await promoteBlock(db, ticketBlock, other);

    const [entry] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.sourceRow, 3));
    expect(entry).toMatchObject({
      eventId: event.id,
      budgetLineId: line.id,
      transferGroupId: group,
      recordedBy: 'lead@shliff.test',
    });
    const [round] = await db.select().from(ticketRounds);
    expect(round).toMatchObject({ eventId: event.id, sold: true });
  });
});

describe('promoteBlock — whole-block refusals', () => {
  it('refuses an unconfirmed block', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP, { confirmed: false });
    const result = await promoteBlock(db, blockId, LEAD);
    expect(result.written).toHaveLength(0);
    expect(result.refused).toHaveLength(1);
  });

  it('refuses an archetype with no promoter in this wave', async () => {
    const blockId = await addBlock(sheetId, 'event_lines', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, LEAD);
    expect(result.refused[0].reason).toBe('no-promoter');
    expect(result.written).toHaveLength(0);
  });

  it('tells a lead that account balances are set by hand, not that they are waiting', async () => {
    const balances = await addBlock(sheetId, 'account_balances', LEDGER_GRID, LEDGER_MAP);
    const events = await addBlock(sheetId, 'event_lines', LEDGER_GRID, LEDGER_MAP, { top: 20 });
    const rb = await promoteBlock(db, balances, LEAD);
    const re = await promoteBlock(db, events, LEAD);

    expect(rb.refused[0].reason).toBe('no-promoter');
    expect(rb.refused[0].message).toBe('יתרות חשבונות נקבעות ידנית ולא נקלטות מגיליון');
    expect(re.refused[0].message).not.toBe(rb.refused[0].message);
  });

  it('refuses every block on an undecided colliding sheet', async () => {
    const other = await addSheet('25.xlsx', 'סיכום כללי');
    await setSheetSeason(db, other, s26);
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, LEAD);
    expect(result.refused[0].reason).toBe('sheet-undecided');
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it('promotes once the colliding sheet has been resolved', async () => {
    const other = await addSheet('25.xlsx', 'סיכום כללי');
    await setSheetSeason(db, other, s26);
    await setSheetAuthority(db, sheetId, true);
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, LEAD);
    expect(result.written).toHaveLength(2);
  });

  it('refuses the superseded copy while the authoritative one promotes', async () => {
    const other = await addSheet('25.xlsx', 'סיכום כללי');
    await setSheetSeason(db, other, s26);
    await setSheetAuthority(db, sheetId, true);
    const losing = await addBlock(other, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, losing, LEAD);
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

    await promoteBlock(db, ba, LEAD);
    await promoteBlock(db, bb, LEAD);

    expect(await db.select().from(budgetLines)).toHaveLength(0);
    expect(await budgetTotalAgorot(db, s26)).toBe(0);
  });

  it('throws on a sheet the eligibility map does not know', async () => {
    const orphan = await addSheet('lost.xlsx', 'גיליון יתום');
    await setSheetSeason(db, orphan, s26);
    const blockId = await addBlock(orphan, 'ledger', LEDGER_GRID, LEDGER_MAP);
    // Every sheet belongs to an upload; only a broken database has one that
    // does not. Break it on purpose so the invariant has something to catch.
    const [{ uploadId }] = await db.select({ uploadId: sheets.uploadId })
      .from(sheets).where(eq(sheets.id, orphan));
    await db.execute(sql.raw('ALTER TABLE sheets DROP CONSTRAINT sheets_upload_id_uploads_id_fk'));
    await db.delete(uploads).where(eq(uploads.id, uploadId));

    await expect(promoteBlock(db, blockId, DRY)).rejects.toThrow(`unknown sheet ${orphan}`);
  });
});

describe('promoteBlock — a refused block releases its rows', () => {
  it('releases the old copy when a lead moves authority to the other one', async () => {
    const a = await addSheet('25.xlsx', 'תקציב קאמפ ברן 26');
    const b = await addSheet('2026.xlsx', 'תקציב קאמפ ברן 26');
    await setSheetSeason(db, a, s26);
    await setSheetSeason(db, b, s26);
    const ba = await addBlock(a, 'budget_lines', BUDGET_GRID, BUDGET_MAP);
    const bb = await addBlock(b, 'budget_lines', BUDGET_GRID, BUDGET_MAP);

    await setSheetAuthority(db, a, true);
    expect((await promoteBlock(db, ba, LEAD)).written).toHaveLength(1);
    expect(await budgetTotalAgorot(db, s26)).toBe(5852300);

    await setSheetAuthority(db, a, false);
    await setSheetAuthority(db, b, true);

    const dry = await promoteBlock(db, ba, DRY);
    expect(dry.refused[0].reason).toBe('sheet-superseded');
    expect(dry.deleted).toBe(1);
    expect(await db.select().from(budgetLines)).toHaveLength(1);

    const ra = await promoteBlock(db, ba, LEAD);
    const rb = await promoteBlock(db, bb, LEAD);
    expect(ra.refused[0].reason).toBe('sheet-superseded');
    expect(ra.deleted).toBe(1);
    expect(rb.written).toHaveLength(1);

    const rows = await db.select().from(budgetLines);
    expect(rows.map((r) => r.sourceBlockId)).toEqual([bb]);
    expect(await budgetTotalAgorot(db, s26)).toBe(5852300);
  });

  it('releases a promoted copy that a later same-named upload makes undecided', async () => {
    const a = await addSheet('25.xlsx', 'תקציב קאמפ ברן 26');
    await setSheetSeason(db, a, s26);
    const ba = await addBlock(a, 'budget_lines', BUDGET_GRID, BUDGET_MAP);
    expect((await promoteBlock(db, ba, LEAD)).written).toHaveLength(1);

    const c = await addSheet('2027.xlsx', 'תקציב קאמפ ברן 26');
    const bc = await addBlock(c, 'budget_lines', BUDGET_GRID, BUDGET_MAP);
    const ra = await promoteBlock(db, ba, LEAD);
    expect(ra.refused[0].reason).toBe('sheet-undecided');
    expect(ra.deleted).toBe(1);
    expect(await db.select().from(budgetLines)).toHaveLength(0);

    await setSheetSeason(db, c, s26);
    await setSheetAuthority(db, c, true);
    await promoteBlock(db, ba, LEAD);
    await promoteBlock(db, bc, LEAD);
    expect(await budgetTotalAgorot(db, s26)).toBe(5852300);
  });

  it('releases the rows of a block that is no longer confirmed', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, LEAD);
    await db.update(blocks).set({ confirmedAt: null, confirmedBy: null })
      .where(eq(blocks.id, blockId));

    const result = await promoteBlock(db, blockId, LEAD);
    expect(result.refused.map((r) => r.reason)).toEqual(['unconfirmed']);
    expect(result.deleted).toBe(2);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it('releases the rows of a block that lost its column mapping', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, LEAD);
    await db.delete(blockMappings).where(eq(blockMappings.blockId, blockId));

    const result = await promoteBlock(db, blockId, LEAD);
    expect(result.refused.map((r) => r.reason)).toEqual(['unmapped-column']);
    expect(result.deleted).toBe(2);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it('removes a block\'s ledger rows when it is re-confirmed as a budget', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, LEAD);

    await reconfirm(blockId, 'budget_lines', BUDGET_GRID, BUDGET_MAP);
    const result = await promoteBlock(db, blockId, LEAD);

    expect(result.written).toHaveLength(1);
    expect(result.deleted).toBe(2);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
    const lines = await db.select().from(budgetLines);
    expect(lines.map((l) => [l.sourceBlockId, l.sourceRow])).toEqual([[blockId, 2]]);
  });

  it('removes a block\'s ledger rows when it is re-confirmed as an archetype with no promoter', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, LEAD);

    await reconfirm(blockId, 'event_lines', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, LEAD);

    expect(result.refused[0].reason).toBe('no-promoter');
    expect(result.deleted).toBe(2);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it('sweeps obligations and ticket rounds too, not only the ledger and the budget', async () => {
    const obl = await addBlock(sheetId, 'obligations', OBL_GRID, OBL_MAP);
    const ticketGrid = [['סבב', 'כמות', 'מחיר', 'לסבב'], ['סבב א׳', '100', '150', '15000']];
    const tix = await addBlock(sheetId, 'ticket_rounds', ticketGrid, TICKET_MAP, { top: 20 });
    await promoteBlock(db, obl, LEAD);
    await promoteBlock(db, tix, LEAD);

    await reconfirm(obl, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await reconfirm(tix, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const ro = await promoteBlock(db, obl, LEAD);
    const rt = await promoteBlock(db, tix, LEAD);

    expect(ro.deleted).toBe(2);
    expect(rt.deleted).toBe(1);
    expect(await db.select().from(obligations)).toHaveLength(0);
    expect(await db.select().from(ticketRounds)).toHaveLength(0);
  });
});

describe('promoteBlock — a stale row something depends on is retained', () => {
  async function settledObligations(): Promise<{ blockId: string; josephId: string }> {
    await createPerson(db, 'יוסף', 'lead@shliff.test');
    const blockId = await addBlock(sheetId, 'obligations', OBL_GRID, OBL_MAP);
    await promoteBlock(db, blockId, LEAD);
    const [joseph] = await db.select().from(obligations).where(eq(obligations.sourceRow, 2));
    await settleObligation(db, {
      obligationId: joseph.id, amount: 6000, kind: 'offset', note: 'קיזוז מול דמי קאמפ',
      settledOn: new Date(), recordedBy: 'lead@shliff.test',
    });
    return { blockId, josephId: joseph.id };
  }

  it('keeps a settled obligation whose row stops producing, and its settlement', async () => {
    const { blockId, josephId } = await settledObligations();
    const changed = copy(OBL_GRID);
    changed[1][2] = '';
    changed[2][2] = '';
    await setGrid(blockId, changed);

    const result = await promoteBlock(db, blockId, LEAD);

    expect(result.deleted).toBe(1);
    expect(result.retained).toEqual([{
      table: 'obligations', id: josephId, sheetRow: 2, reason: expect.any(String),
    }]);
    expect(result.retained[0].reason).not.toBe('');
    expect((await db.select().from(obligations)).map((o) => o.id)).toEqual([josephId]);
    expect(await db.select().from(obligationSettlements)).toHaveLength(1);
  });

  it('a dry run reports the same retained and deleted rows and changes nothing', async () => {
    const { blockId, josephId } = await settledObligations();
    const changed = copy(OBL_GRID);
    changed[1][2] = '';
    changed[2][2] = '';
    await setGrid(blockId, changed);

    const dry = await promoteBlock(db, blockId, DRY);
    expect(dry.deleted).toBe(1);
    expect(dry.retained.map((r) => [r.table, r.id, r.sheetRow])).toEqual([
      ['obligations', josephId, 2],
    ]);
    expect(await db.select().from(obligations)).toHaveLength(2);
    expect(await db.select().from(obligationSettlements)).toHaveLength(1);
  });

  it('keeps a settled obligation when its whole block is refused', async () => {
    const { blockId, josephId } = await settledObligations();
    await db.update(blocks).set({ confirmedAt: null }).where(eq(blocks.id, blockId));

    const result = await promoteBlock(db, blockId, LEAD);

    expect(result.refused.map((r) => r.reason)).toEqual(['unconfirmed']);
    expect(result.deleted).toBe(1);
    expect(result.retained.map((r) => r.id)).toEqual([josephId]);
    expect(await db.select().from(obligationSettlements)).toHaveLength(1);
  });

  it('keeps a ledger row a settlement points at', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, LEAD);
    const [entry] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.sourceRow, 2));
    const debt = await createObligation(db, {
      direction: 'camp_owes', partyName: 'ספק', description: 'מקדמה',
      amount: 4000, openedOn: new Date('2025-05-01'),
    });
    await settleObligation(db, {
      obligationId: debt, amount: 4000, kind: 'cash', ledgerEntryId: entry.id,
      settledOn: new Date('2025-05-20'), recordedBy: 'lead@shliff.test',
    });

    await reconfirm(blockId, 'event_lines', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, LEAD);

    expect(result.deleted).toBe(1);
    expect(result.retained.map((r) => [r.table, r.id, r.sheetRow])).toEqual([
      ['ledger_entries', entry.id, 2],
    ]);
    const [settlement] = await db.select().from(obligationSettlements);
    expect(settlement.ledgerEntryId).toBe(entry.id);
  });

  it('keeps a ledger row that is one leg of a transfer, and deletes one that pairs with nothing', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, LEAD);
    const group = randomUUID();
    await db.update(ledgerEntries).set({ transferGroupId: group })
      .where(eq(ledgerEntries.sourceRow, 3));
    await db.update(ledgerEntries).set({ transferGroupId: randomUUID() })
      .where(eq(ledgerEntries.sourceRow, 2));
    await recordEntry(db, {
      occurredOn: new Date('2025-10-30'), direction: 'out', amount: 57000,
      description: 'העברה לבנק', transferGroupId: group, recordedBy: 'lead@shliff.test',
    });

    const changed = copy(LEDGER_GRID);
    changed[1][1] = 'סה"כ';
    changed[2][1] = 'סה"כ';
    await setGrid(blockId, changed);
    const result = await promoteBlock(db, blockId, LEAD);

    expect(result.deleted).toBe(1);
    expect(result.retained.map((r) => [r.table, r.sheetRow])).toEqual([['ledger_entries', 3]]);
    expect(await db.select().from(ledgerEntries)).toHaveLength(2);
  });

  it('keeps a budget line a ledger entry is booked against', async () => {
    const blockId = await addBlock(sheetId, 'budget_lines', BUDGET_GRID, BUDGET_MAP);
    await promoteBlock(db, blockId, LEAD);
    const [line] = await db.select().from(budgetLines);
    await recordEntry(db, {
      occurredOn: new Date('2025-06-01'), direction: 'out', amount: 100,
      description: 'חשבונית', budgetLineId: line.id, recordedBy: 'lead@shliff.test',
    });

    await setGrid(blockId, [BUDGET_GRID[0], ['', '', '', '', '']]);
    const result = await promoteBlock(db, blockId, LEAD);

    expect(result.deleted).toBe(0);
    expect(result.retained.map((r) => [r.table, r.id, r.sheetRow])).toEqual([
      ['budget_lines', line.id, 2],
    ]);
    const [entry] = await db.select().from(ledgerEntries);
    expect(entry.budgetLineId).toBe(line.id);
  });

  it('keeps a budget line a task points at, though no foreign key says so', async () => {
    const blockId = await addBlock(sheetId, 'budget_lines', BUDGET_GRID, BUDGET_MAP);
    await promoteBlock(db, blockId, LEAD);
    const [line] = await db.select().from(budgetLines);
    await createTask(db, {
      seasonId: s26, kind: 'deliverable', title: 'רחבה', budgetLineId: line.id,
    });

    await setGrid(blockId, [BUDGET_GRID[0], ['', '', '', '', '']]);
    const result = await promoteBlock(db, blockId, LEAD);

    expect(result.deleted).toBe(0);
    expect(result.retained.map((r) => [r.table, r.id])).toEqual([['budget_lines', line.id]]);
    expect(await db.select().from(budgetLines)).toHaveLength(1);
  });

  it('releases a budget line whose only reference is a row this same sweep deletes', async () => {
    const blockId = await addBlock(sheetId, 'budget_lines', BUDGET_GRID, BUDGET_MAP);
    await promoteBlock(db, blockId, LEAD);
    const [line] = await db.select().from(budgetLines);
    await db.insert(ledgerEntries).values({
      occurredOn: new Date('2025-06-01'), direction: 'out', amount: '100.00',
      description: 'שורה של אותו בלוק', budgetLineId: line.id, recordedBy: 'lead@shliff.test',
      sourceBlockId: blockId, sourceRow: 2,
    });
    await reconfirm(blockId, 'event_lines', BUDGET_GRID, BUDGET_MAP);

    const dry = await promoteBlock(db, blockId, DRY);
    expect([dry.deleted, dry.retained]).toEqual([2, []]);

    const result = await promoteBlock(db, blockId, LEAD);
    expect([result.deleted, result.retained]).toEqual([2, []]);
    expect(await db.select().from(budgetLines)).toHaveLength(0);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });
});

describe('promoteBlock — values the database cannot hold', () => {
  it('refuses an amount beyond numeric(12,2) in the dry run and the commit alike', async () => {
    const grid = copy(LEDGER_GRID_3);
    grid[2][3] = '99999999999';
    const blockId = await addBlock(sheetId, 'ledger', grid, LEDGER_MAP);

    const dry = await promoteBlock(db, blockId, DRY);
    const real = await promoteBlock(db, blockId, LEAD);

    for (const result of [dry, real]) {
      expect(result.written.map((w) => w.sheetRow)).toEqual([2, 4]);
      expect(result.refused).toHaveLength(1);
      expect(result.refused[0]).toMatchObject({ sheetRow: 3, reason: 'out-of-range' });
      expect(result.refused[0].message).toContain('99999999999');
      expect(result.refused[0].cells).toEqual(grid[2]);
    }
    expect(await db.select().from(ledgerEntries)).toHaveLength(2);
  });

  it('accepts the largest amount numeric(12,2) holds and refuses one agora more', async () => {
    const grid = [
      LEDGER_GRID_3[0],
      ['20/05/2025', 'גבול', '9999999999.99', ''],
      ['20/05/2025', 'מעבר לגבול', '10000000000.00', ''],
    ];
    const blockId = await addBlock(sheetId, 'ledger', grid, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, LEAD);

    expect(result.refused.map((r) => [r.sheetRow, r.reason])).toEqual([[3, 'out-of-range']]);
    const [row] = await db.select().from(ledgerEntries);
    expect(row.amount).toBe('9999999999.99');
  });

  it('checks every numeric column of a budget line, whatever its sign', async () => {
    const grid = [
      BUDGET_GRID[0],
      ['שלילי', '1', '1', '-99999999999', ''],
      ['מחיר', '1', '99999999999', '1', ''],
      ['כמות', '99999999999', '1', '1', ''],
      ['סך', '1', '1', '99999999999', ''],
      ['תקין', '1', '10', '10', ''],
    ];
    const blockId = await addBlock(sheetId, 'budget_lines', grid, BUDGET_MAP);
    const result = await promoteBlock(db, blockId, LEAD);

    expect(result.refused.map((r) => [r.sheetRow, r.reason])).toEqual([
      [2, 'out-of-range'], [3, 'out-of-range'], [4, 'out-of-range'], [5, 'out-of-range'],
    ]);
    expect(result.written.map((w) => w.sheetRow)).toEqual([6]);
  });

  it('refuses a ticket quantity beyond Postgres integer, and an oversized price or total', async () => {
    const grid = [
      ['סבב', 'כמות', 'מחיר', 'לסבב'],
      ['גדול', '3000000000', '1', '100'],
      ['שלילי', '-3000000000', '1', '100'],
      ['מחיר', '1', '99999999999', '100'],
      ['סך', '1', '1', '99999999999'],
      ['גבול', '2147483647', '1', '100'],
    ];
    const blockId = await addBlock(sheetId, 'ticket_rounds', grid, TICKET_MAP);

    const dry = await promoteBlock(db, blockId, DRY);
    const real = await promoteBlock(db, blockId, LEAD);

    for (const result of [dry, real]) {
      expect(result.refused.map((r) => [r.sheetRow, r.reason])).toEqual([
        [2, 'out-of-range'], [3, 'out-of-range'], [4, 'out-of-range'], [5, 'out-of-range'],
      ]);
      expect(result.written.map((w) => w.sheetRow)).toEqual([6]);
    }
    expect(real.refused[0].message).toContain('3000000000');
    const [round] = await db.select().from(ticketRounds);
    expect(round.quantity).toBe(2147483647);
  });

  it('refuses an oversized obligation before queueing its party name', async () => {
    const grid = [
      OBL_GRID[0],
      ['דני', 'חוב ענק', '99999999999', '20/05/2025'],
    ];
    const blockId = await addBlock(sheetId, 'obligations', grid, OBL_MAP);
    const result = await promoteBlock(db, blockId, LEAD);

    expect(result.refused.map((r) => [r.sheetRow, r.reason])).toEqual([[2, 'out-of-range']]);
    expect(await db.select().from(obligations)).toHaveLength(0);
    expect((await listUnlinkedNames(db)).map((n) => n.alias)).not.toContain('דני');
  });
});

describe('promoteBlock — one block, one transaction', () => {
  it('leaves nothing half-written when a row fails in the database', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID_3, LEDGER_MAP);
    await promoteBlock(db, blockId, LEAD);
    await db.execute(sql.raw(
      "ALTER TABLE ledger_entries ADD CONSTRAINT test_no_boom CHECK (description <> 'בום')",
    ));

    const changed = copy(LEDGER_GRID_3);
    changed[1][2] = '4500';   // row 2 is updated first
    changed[2][1] = 'בום';    // row 3 then fails in the database
    changed[3][1] = 'סה"כ';   // row 4 would have been swept
    await setGrid(blockId, changed);

    await expect(promoteBlock(db, blockId, LEAD)).rejects.toThrow();

    const rows = await db.select().from(ledgerEntries).orderBy(asc(ledgerEntries.sourceRow));
    expect(rows.map((r) => [r.sourceRow, r.amount, r.description])).toEqual([
      [2, '4000.00', 'מקדמה מייצג'],
      [3, '57000.00', 'מסיבת פקאנים'],
      [4, '100.00', 'עוד תנועה'],
    ]);
  });

  it('rolls back the writes when the sweep fails', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID_3, LEDGER_MAP);
    await promoteBlock(db, blockId, LEAD);
    const [row4] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.sourceRow, 4));
    // A dependency this module does not know about, so its guard cannot
    // retain the row and the delete itself fails.
    await db.execute(sql.raw(
      'CREATE TABLE test_pin (entry_id uuid NOT NULL REFERENCES ledger_entries(id) ON DELETE RESTRICT)',
    ));
    await db.execute(sql.raw(`INSERT INTO test_pin VALUES ('${row4.id}')`));

    const changed = copy(LEDGER_GRID_3);
    changed[1][2] = '4500';
    changed[3][1] = 'סה"כ';
    await setGrid(blockId, changed);

    await expect(promoteBlock(db, blockId, LEAD)).rejects.toThrow();

    const [row2] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.sourceRow, 2));
    expect(row2.amount).toBe('4000.00');
  });
});

describe('promoteBlock — party resolution', () => {
  it('links a party when exactly one person matches exactly', async () => {
    const personId = await createPerson(db, 'יוסף', 'lead@shliff.test');
    const blockId = await addBlock(sheetId, 'obligations', OBL_GRID, OBL_MAP);
    await promoteBlock(db, blockId, LEAD);

    const rows = await listObligations(db, { seasonId: s26 });
    const joseph = rows.find((r) => r.description === 'חוב יוסף');
    expect(joseph).toBeDefined();
    expect(joseph?.partyPersonId).toBe(personId);
    expect(joseph?.partyName).toBeNull();
  });

  it('keeps the raw name and queues it when nobody matches', async () => {
    const blockId = await addBlock(sheetId, 'obligations', OBL_GRID, OBL_MAP);
    await promoteBlock(db, blockId, LEAD);

    const rows = await listObligations(db, { seasonId: s26 });
    const joseph = rows.find((r) => r.description === 'חוב יוסף');
    expect(joseph).toBeDefined();
    expect(joseph?.partyPersonId).toBeNull();
    expect(joseph?.partyName).toBe('יוסף');
    expect((await listUnlinkedNames(db)).map((n) => n.alias)).toContain('יוסף');
  });

  it('keeps a nameless obligation and marks it unnamed', async () => {
    const blockId = await addBlock(sheetId, 'obligations', OBL_GRID, OBL_MAP);
    await promoteBlock(db, blockId, LEAD);

    const rows = await listObligations(db, { seasonId: s26 });
    const nameless = rows.find((r) => r.description === 'החזר הוצאות');
    expect(nameless).toBeDefined();
    expect(nameless?.unnamed).toBe(true);
  });

  it('a dry run queues no unlinked names', async () => {
    const blockId = await addBlock(sheetId, 'obligations', OBL_GRID, OBL_MAP);
    await promoteBlock(db, blockId, DRY);
    expect(await listUnlinkedNames(db)).toHaveLength(0);
    expect(await db.select().from(obligations)).toHaveLength(0);
  });
});

describe('promoteAll', () => {
  it('promotes every eligible confirmed block and counts what it did', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const parked = await addBlock(sheetId, 'event_lines', LEDGER_GRID, LEDGER_MAP, { top: 10 });
    const result = await promoteAll(db, { dryRun: false, recordedBy: 'lead@shliff.test' });

    expect(result.writtenCount).toBe(2);
    expect(result.results.map((r) => r.blockId).sort()).toEqual([blockId, parked].sort());
    const parkedResult = result.results.find((r) => r.blockId === parked);
    expect(parkedResult?.refused[0].reason).toBe('no-promoter');
  });

  it('skips unconfirmed blocks entirely rather than reporting them as refusals', async () => {
    await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP, { confirmed: false });
    const result = await promoteAll(db, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(result.results).toHaveLength(0);
  });

  it('is a no-op on a second run when nothing changed', async () => {
    await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteAll(db, { dryRun: false, recordedBy: 'lead@shliff.test' });
    const second = await promoteAll(db, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(second.deletedCount).toBe(0);
    expect(await db.select().from(ledgerEntries)).toHaveLength(2);
  });

  it('aggregates written, refused, deleted and retained counts across every block', async () => {
    const ledgerBlock = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP, { top: 1 });
    await promoteBlock(db, ledgerBlock, LEAD);
    const changed = copy(LEDGER_GRID);
    changed[2][1] = 'סה"כ'; // the second data row becomes a total; the ledger block stops producing it
    await setGrid(ledgerBlock, changed);

    await createPerson(db, 'יוסף', 'lead@shliff.test');
    const oblBlock = await addBlock(sheetId, 'obligations', OBL_GRID, OBL_MAP, { top: 20 });
    await promoteBlock(db, oblBlock, LEAD);
    const [joseph] = await db.select().from(obligations).where(eq(obligations.sourceRow, 21));
    await settleObligation(db, {
      obligationId: joseph.id, amount: 6000, kind: 'offset', note: 'קיזוז מול דמי קאמפ',
      settledOn: new Date(), recordedBy: 'lead@shliff.test',
    });
    const obChanged = copy(OBL_GRID);
    obChanged[1][2] = '';
    obChanged[2][2] = '';
    await setGrid(oblBlock, obChanged);

    const result = await promoteAll(db, { dryRun: false, recordedBy: 'lead@shliff.test' });

    // The stale ledger row and the nameless obligation row, from two
    // different blocks — one deletedCount, summed.
    expect(result.deletedCount).toBe(2);
    expect(result.retainedCount).toBe(1); // the settled obligation
    expect(await db.select().from(ledgerEntries)).toHaveLength(1);
    expect(await db.select().from(obligations)).toHaveLength(1);
  });

  it('a dry run aggregates what a bulk commit would delete and retain, and changes nothing', async () => {
    const ledgerBlock = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP, { top: 1 });
    await promoteBlock(db, ledgerBlock, LEAD);
    const changed = copy(LEDGER_GRID);
    changed[2][1] = 'סה"כ';
    await setGrid(ledgerBlock, changed);

    await createPerson(db, 'יוסף', 'lead@shliff.test');
    const oblBlock = await addBlock(sheetId, 'obligations', OBL_GRID, OBL_MAP, { top: 20 });
    await promoteBlock(db, oblBlock, LEAD);
    const [joseph] = await db.select().from(obligations).where(eq(obligations.sourceRow, 21));
    await settleObligation(db, {
      obligationId: joseph.id, amount: 6000, kind: 'offset', note: 'קיזוז מול דמי קאמפ',
      settledOn: new Date(), recordedBy: 'lead@shliff.test',
    });
    const obChanged = copy(OBL_GRID);
    obChanged[1][2] = '';
    obChanged[2][2] = '';
    await setGrid(oblBlock, obChanged);

    const dry = await promoteAll(db, { dryRun: true, recordedBy: 'lead@shliff.test' });

    expect(dry.deletedCount).toBe(2);
    expect(dry.retainedCount).toBe(1);
    expect(await db.select().from(ledgerEntries)).toHaveLength(2);
    expect(await db.select().from(obligations)).toHaveLength(2);
  });

  it('records a mid-write database failure as a failure, and leaves an earlier block\'s savepoint-committed rows standing', async () => {
    const first = await addBlock(sheetId, 'ledger', LEDGER_GRID_3, LEDGER_MAP, { top: 1 });
    const second = await addBlock(sheetId, 'ledger', LEDGER_GRID_3, LEDGER_MAP, { top: 20 });
    await db.execute(sql.raw(
      "ALTER TABLE ledger_entries ADD CONSTRAINT test_no_boom CHECK (description <> 'בום')",
    ));
    const badGrid = copy(LEDGER_GRID_3);
    badGrid[2][1] = 'בום';
    await setGrid(second, badGrid);

    const result = await promoteAll(db, { dryRun: false, recordedBy: 'lead@shliff.test' });

    // The whole bulk run still commits: promoteAll no longer throws for a
    // per-block database error, and returns a complete BulkResult.
    expect(result.failedCount).toBe(1);
    expect(result.failures).toEqual([{ blockId: second, message: expect.any(String) }]);
    expect(result.results.map((r) => r.blockId)).toEqual([first]);

    // Proof the failing block's SAVEPOINT rolled back on its own, without
    // undoing the earlier block's already-committed-within-the-transaction
    // writes: both blocks share one outer transaction (see `promoteAll`).
    const rows = await db.select().from(ledgerEntries);
    expect(rows.filter((r) => r.sourceBlockId === first)).toHaveLength(3);
    expect(rows.filter((r) => r.sourceBlockId === second)).toHaveLength(0);
  });

  it('orders results by sheet name ahead of insertion or sheet-id order', async () => {
    const sheetZ = await addSheet('z.xlsx', 'zz-sheet');
    const sheetA = await addSheet('a.xlsx', 'aa-sheet');
    // sheetZ (and its block) is created first — a wrong implementation that
    // ignores sheets.name, or sorts by sheet id/creation order, would put
    // blockOnZ ahead of blockOnA.
    const blockOnZ = await addBlock(sheetZ, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const blockOnA = await addBlock(sheetA, 'ledger', LEDGER_GRID, LEDGER_MAP);

    const result = await promoteAll(db, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(result.results.map((r) => r.blockId)).toEqual([blockOnA, blockOnZ]);
  });

  it('orders results by block top ascending within a sheet, regardless of insertion order', async () => {
    // Created in reverse of the expected order: the top-20 block first, the
    // top-1 block second. A wrong implementation without `orderBy(blocks.top)`
    // would likely return them in insertion (i.e. reversed) order.
    const later = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP, { top: 20 });
    const earlier = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP, { top: 1 });

    const result = await promoteAll(db, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(result.results.map((r) => r.blockId)).toEqual([earlier, later]);
  });

  it('promotes a mixed confirmed/unconfirmed set in one call, reporting only the confirmed block', async () => {
    const confirmed = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP, { top: 1 });
    await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP, { top: 20, confirmed: false });

    const result = await promoteAll(db, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(result.results.map((r) => r.blockId)).toEqual([confirmed]);
  });
});
