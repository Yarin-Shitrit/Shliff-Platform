import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { uploads, sheets, blocks } from '@/db/schema/source';
import { createObligation, settleObligation } from './obligations';
import { traceRow } from './trace';
import { listDebts, applyDebtView, debtTotals } from './debts-view';

const LEAD = 'lead@example.com';
let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });

async function seedBlock(sheetName: string, left: number): Promise<string> {
  const [up] = await db.insert(uploads).values({
    filename: '2026.xlsx', sha256: `sha/${sheetName}/${left}`,
    storageKey: `k/${sheetName}/${left}`, sizeBytes: 1,
    uploadedBy: LEAD, status: 'committed',
  }).returning();
  const [sheet] = await db.insert(sheets).values({
    uploadId: up.id, name: sheetName, index: 0, rowCount: 60, colCount: 8,
  }).returning();
  const [block] = await db.insert(blocks).values({
    sheetId: sheet.id, top: 1, left, bottom: 50, right: left,
    archetype: 'obligations', confidence: '1.0000', headerRow: null, fingerprint: null,
    pipelineVersion: 1, rawGrid: [['x']], confirmedBy: LEAD, confirmedAt: new Date(),
  }).returning();
  return block.id;
}

describe('the debts view', () => {
  it('shows a dateless debt as dateless and sorts it last', async () => {
    await createObligation(db, {
      direction: 'camp_owes', partyName: 'תמר גולן',
      description: 'החזר על מקררים', amount: 180, openedOn: null,
    });
    await createObligation(db, {
      direction: 'camp_owes', partyName: 'רוני אדלר',
      description: 'מקדמה לגנרטור', amount: 15240,
      openedOn: new Date('2026-07-02T00:00:00Z'),
    });
    const rows = await listDebts(db);
    expect(rows.map((r) => r.description)).toEqual(['מקדמה לגנרטור', 'החזר על מקררים']);
    expect(rows.map((r) => r.dateless)).toEqual([false, true]);
  });

  it('keeps a nameless debt in a season view, because it belongs to no season', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    await createObligation(db, {
      direction: 'camp_owes', description: 'שולם 500 — מקפיא באיחסון נוסף',
      amount: 500, openedOn: null,
    });
    await createObligation(db, {
      direction: 'camp_owes', partyName: 'אורי', description: 'החזר',
      amount: 300, seasonId: season.id, openedOn: new Date('2026-07-02T00:00:00Z'),
    });
    const rows = await listDebts(db, { seasonId: season.id });
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.unnamed)).toHaveLength(1);
  });

  it('never lists the same debt twice when it is both nameless and in the season', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    await createObligation(db, {
      direction: 'camp_owes', description: 'שולם 400 — דולב זבל במחסן',
      amount: 400, seasonId: season.id, openedOn: null,
    });
    expect(await listDebts(db, { seasonId: season.id })).toHaveLength(1);
  });

  it('carries the workbook cell a debt came from, and agrees with traceRow', async () => {
    const blockId = await seedBlock('סיכום כללי', 4);
    const id = await createObligation(db, {
      direction: 'camp_owes', description: 'שולם 500 — מקפיא באיחסון נוסף',
      amount: 500, openedOn: null, sourceBlockId: blockId, sourceRow: 44,
    });
    const [row] = await listDebts(db);
    const traced = await traceRow(db, 'obligations', id);
    expect(traced!.reference).toBe('סיכום כללי!D44');
    expect(row.source).toEqual(traced);
  });

  it('says a debt a lead typed came from nobody, rather than inventing a cell', async () => {
    await createObligation(db, {
      direction: 'camp_owes', partyName: 'אורי', description: 'החזר',
      amount: 300, openedOn: null,
    });
    const [row] = await listDebts(db);
    expect(row.source).toBeNull();
  });

  it('totals each direction separately and never nets them against each other', async () => {
    const id = await createObligation(db, {
      direction: 'camp_owes', partyName: 'רוני אדלר', description: 'מקדמה לגנרטור',
      amount: 15240, openedOn: new Date('2026-07-02T00:00:00Z'),
    });
    await settleObligation(db, {
      obligationId: id, amount: 14330, kind: 'offset', note: 'מול דמי קאמפ',
      settledOn: new Date('2026-07-20T00:00:00Z'), recordedBy: LEAD,
    });
    await createObligation(db, {
      direction: 'owed_to_camp', partyName: 'מאיה פרץ', description: 'כרטיס',
      amount: 2350, openedOn: new Date('2026-07-05T00:00:00Z'),
    });
    const totals = debtTotals(await listDebts(db));
    // Outstanding, never the original amount: a debt 14,330 of the way paid
    // off would otherwise read as though nothing had been paid against it.
    expect(totals.campOwesAgorot).toBe(91000);
    expect(totals.owedToCampAgorot).toBe(235000);
    expect(totals.campOwesCount).toBe(1);
    expect(totals.owedToCampCount).toBe(1);
  });

  it('counts what was closed by offset, which moved no cash', async () => {
    const id = await createObligation(db, {
      direction: 'camp_owes', partyName: 'יוסף', description: 'חוב יוסף',
      amount: 15240, openedOn: new Date('2026-07-02T00:00:00Z'),
    });
    await settleObligation(db, {
      obligationId: id, amount: 6000, kind: 'offset',
      note: 'יוסף קארינה יונתן ירין ועילאי',
      settledOn: new Date('2026-07-20T00:00:00Z'), recordedBy: LEAD,
    });
    const totals = debtTotals(await listDebts(db));
    expect(totals.offsetAgorot).toBe(600000);
    expect(totals.offsetCount).toBe(1);
  });

  it('counts the nameless separately, because they are the ones nobody can close', async () => {
    await createObligation(db, {
      direction: 'camp_owes', description: 'שולם 500 — מקפיא באיחסון נוסף',
      amount: 500, openedOn: null,
    });
    await createObligation(db, {
      direction: 'camp_owes', partyName: 'אורי', description: 'החזר',
      amount: 300, openedOn: null,
    });
    const totals = debtTotals(await listDebts(db));
    expect(totals.unnamedCount).toBe(1);
    expect(totals.unnamedAgorot).toBe(50000);
  });

  it('splits open from settled', async () => {
    const open = await createObligation(db, {
      direction: 'camp_owes', partyName: 'רוני', description: 'פתוח',
      amount: 500, openedOn: new Date('2026-07-02T00:00:00Z'),
    });
    const closed = await createObligation(db, {
      direction: 'owed_to_camp', partyName: 'מאיה', description: 'סגור',
      amount: 300, openedOn: new Date('2026-07-03T00:00:00Z'),
    });
    await settleObligation(db, {
      obligationId: closed, amount: 300, kind: 'cash',
      settledOn: new Date('2026-07-20T00:00:00Z'), recordedBy: LEAD,
    });
    expect(open).toBeTruthy();
    const rows = await listDebts(db);
    expect(applyDebtView(rows, 'camp_owes').every((r) => !r.settled)).toBe(true);
    expect(applyDebtView(rows, 'camp_owes').map((r) => r.description)).toEqual(['פתוח']);
    expect(applyDebtView(rows, 'owed_to_camp')).toHaveLength(0);
    expect(applyDebtView(rows, 'settled').every((r) => r.settled)).toBe(true);
    expect(applyDebtView(rows, 'settled').map((r) => r.description)).toEqual(['סגור']);
    expect(debtTotals(rows).settledCount).toBe(1);
  });
});
