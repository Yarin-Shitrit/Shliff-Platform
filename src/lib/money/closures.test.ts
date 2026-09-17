import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { seedCampBaseline } from '@/lib/seed/camp-seed';
import { getSeasonByName } from '@/lib/members/roster';
import { uploads, sheets, blocks, blockMappings } from '@/db/schema/source';
import { setSheetSeason } from '@/lib/import/sheets';
import { promoteAll } from '@/lib/import/promote/promote';
import type { ColumnMapping } from '@/lib/classify/map-columns';
import type { BlockArchetype } from '@/lib/classify/types';
import { accountBalances } from './accounts';
import { ledgerTotals, listMovements, recordEntry } from './ledger';
import { budgetTotalAgorot } from './budget';
import {
  fundingTotalAgorot, ticketTotalAgorot, duesFundingIdentity, campBudgetFundingAgorot,
} from './funding';
import { listObligations, unnamedObligations } from './obligations';

const LEAD = 'lead@example.com';
let db: TestDb;

// ---------------------------------------------------------------------------
// The workbook, as cells, promoted the way the real pipeline promotes it
// ---------------------------------------------------------------------------

/**
 * `createTestDb()` applies every migration, so it holds `uploads`, `sheets`,
 * `blocks` and `block_mappings` like any other database — which means the seed
 * and the promoter CAN coexist here, and the four identities the seed used to
 * prove do not have to move out of CI when the seed gives the rows up.
 *
 * What follows is the workbook's own cells, not a second copy of the constants
 * the seed just deleted. They go through `promoteAll`, so each assertion below
 * now gates three things at once where it used to gate one: that the promoter
 * parses these cells, that it refuses the rows it must refuse, and that the
 * closure arithmetic over the resulting rows still comes to the camp's number.
 *
 * Sheet names are distinct per workbook on purpose. In the real corpus both
 * ledger sheets are called `סיכום כללי` and a lead settles the clash with the
 * authority flag; reproducing that here would be testing `sheetEligibility`,
 * which has its own tests, rather than the closures this file is about.
 */
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

/**
 * `סיכום כללי` of `קופת קאמפ 25’` — the seven ברן 25 movements, and the
 * `מעבר לקובץ חדש 44,647` row that must NOT become income.
 *
 * That last row is the whole reason this grid carries more than seven lines.
 * The seed used to leave it out silently; the promoter has to refuse it on its
 * own rule, and the only way to know it does is to hand it the row.
 */
const LEDGER_GRID_25 = [
  ['תאריך', 'פירוט', 'הוצאות', 'הכנסות'],
  ['10/06/2025', 'תרומה אבישי פרץ', '200', ''],
  ['01/08/2025', 'מכולה אוג 25-26', '8850', ''],
  ['01/08/2025', 'מקדמה במה ברן 25', '20660', ''],
  ['27/09/2025', 'רווח מסיבה נמל', '', '34646.55'],
  ['16/10/2025', 'חצי שני למייצג נטלי', '20660', ''],
  ['16/10/2025', 'מברגה לקאמפ', '400', ''],
  ['30/10/2025', 'מסיבת האלווין 30/10', '', '15660'],
  ['', 'מעבר לקובץ חדש', '', '44647'],
];

/** `סיכום כללי` of `קופת קאמפ 2026` — the twelve ברן 26 movements. The gifting
 *  offset carries the workbook's own wording, which is longer than the label
 *  the seed used to store. */
const LEDGER_GRID_26 = [
  ['תאריך', 'פירוט', 'הוצאות', 'הכנסות'],
  ['01/06/2026', 'חוב לירון סלע על ברן 25', '14000', ''],
  ['01/06/2026', 'עובדי הקמה יוניברן', '7350', ''],
  ['01/07/2026', 'קיזוז מול תקציב גיפטינג יוניברן', '', '5000'],
  ['01/07/2026', 'מקדמה מכולות ליולי עד נובמבר', '3000', ''],
  ['18/07/2026', 'רווח מסיבת פקאנים', '', '57000'],
  ['22/07/2026', '3 כרטיסי אומנים ברן', '8820', ''],
  ['22/07/2026', 'ציוד מטבח חדש', '4000', ''],
  ['22/07/2026', 'הובלות', '2000', ''],
  ['01/08/2026', 'מקלחת', '1000', ''],
  ['01/08/2026', 'ציוד מכולה', '231', ''],
  ['01/08/2026', 'פינויים נסורת - להחזיר לאורי', '1200', ''],
  ['01/08/2026', 'מכולה עד דצמבר', '3670', ''],
];

/** `תקציב קאמפ ברן 26` — the twenty-four camp lines, summing to 64,375.30.
 *  `מקרר + מקפיא` really does carry a 0 in the workbook, and a promoter that
 *  refuses a zero-amount row would drop it and still total 64,375.30, so the
 *  count is asserted alongside the sum. */
const BUDGET_GRID_26 = [
  ['סעיף', 'כמות', 'ליחידה', 'סה״כ', 'למה'],
  ['שירותים נסורת', '5', '125', '1625', 'תקציב ברן 25׳ בפועל'],
  ['פינוי שירותים', '18', '125', '2250', 'תקציב ברן 25׳ בפועל'],
  ['ציוד היגיינה', '1', '100', '100', 'תוספת של 70 ש״ח'],
  ['מיכל מים לבנים + מתאם ברז', '2', '1534', '3068', 'תקציב ברן 25׳ צפי לעליית מחיר'],
  ['מיכל מים אפורים', '1', '472', '472', 'תקציב ברן 25 - צריך לקנות'],
  ['מילוי מי שתייה', '5', '590', '2950', 'תוספת מיכל למקלחות'],
  ['פינוי מים אפורים', '4', '708', '2832', 'תוספת מיכל פינויים'],
  ['מקלחות', '2', '750', '1500', 'תוספת 900 שקלים לטובת תאים'],
  ['ציוד משלים למקלחת', '1', '500', '500', 'תוספת 400 שקלים לטובת נוחות'],
  ['חשמל לקאמפ', '12,000kw', '7500', '7500', 'תוספת של עוד 3KWH'],
  ['הובלה', 'מכולה', '12000', '9000', 'תוספת של 2000 שקלים'],
  ['באלות', '20', '15', '300', 'ירידה של 150 שקלים'],
  ['אוכל', 'תפריט שלם לשבוע', '8000', '8000', 'תוספת של 1,000 שקלים'],
  ['ציוד מטבח - כירת גז + מיחם', '1', '850', '930', 'עוד כירת גז'],
  ['מילוי גז', '1', '200', '200', 'מילוי בלון 12 ק״ג'],
  ['מקרר + מקפיא', 'מקרר תעשייתי', '', '0', 'מקרר חדש תעשייתי'],
  ['קרח', '38', '30', '1140', 'תקציב ברן 25׳'],
  ['צילייה מחנה', '600', '14', '9156', 'ירידה של 100 מ״ר'],
  ['גידור מחנה', '200', '14', '2800', 'ירידה של 50 מ״ר'],
  ['הובלה צילייה', '1', '500', '500', 'עלות שקועה'],
  ['100 ק"ג עצים + תוספת אחסנה', '1', '500', '500', 'ירידה של 1000 ש״ח'],
  ['גנרטור', '1', '2200', '2200', 'קונים עוד אחד'],
  ['30 מ׳ לייקרה+ 50 מ׳ בד זול גידור מחנה ונגרר רחבה', '1', '1000', '1000', 'תוספת של 430 ש״ח'],
  ['תקציב הפתעות דק׳ 90', '10% תקציב', '5852.3', '5852.3', ''],
];

async function addSheet(filename: string, name: string, seasonId: string): Promise<string> {
  const [upload] = await db.insert(uploads).values({
    filename, sha256: `${filename}/${name}`, storageKey: `k/${name}`,
    sizeBytes: 1, uploadedBy: LEAD, status: 'committed',
  }).returning();
  const [sheet] = await db.insert(sheets).values({
    uploadId: upload.id, name, index: 0, rowCount: 40, colCount: 6,
  }).returning();
  await setSheetSeason(db, sheet.id, seasonId);
  return sheet.id;
}

async function addBlock(
  sheetId: string, archetype: BlockArchetype, grid: string[][], columnMap: ColumnMapping[],
): Promise<string> {
  const [block] = await db.insert(blocks).values({
    sheetId, top: 1, left: 1, bottom: grid.length, right: columnMap.length,
    archetype, confidence: '1.0000', headerRow: 1, fingerprint: null,
    pipelineVersion: 1, rawGrid: grid,
    confirmedBy: LEAD, confirmedAt: new Date(),
  }).returning();
  await db.insert(blockMappings).values({ blockId: block.id, columnMap, source: 'admin' });
  return block.id;
}

/** Confirms the three blocks the cutover's evidence names and promotes them,
 *  exactly as `promoteAll` does in production. Returns the bulk result so a
 *  test can assert on refusals as well as on totals. */
async function promoteTheWorkbook() {
  const s25 = (await getSeasonByName(db, 'ברן 25'))!;
  const s26 = (await getSeasonByName(db, 'ברן 26'))!;
  await addBlock(
    await addSheet('קופת קאמפ 25.xlsx', 'סיכום כללי 25', s25.id),
    'ledger', LEDGER_GRID_25, LEDGER_MAP,
  );
  await addBlock(
    await addSheet('קופת קאמפ 2026.xlsx', 'סיכום כללי 26', s26.id),
    'ledger', LEDGER_GRID_26, LEDGER_MAP,
  );
  await addBlock(
    await addSheet('קופת קאמפ 2026.xlsx', 'תקציב קאמפ ברן 26', s26.id),
    'budget_lines', BUDGET_GRID_26, BUDGET_MAP,
  );
  return promoteAll(db, { dryRun: false, recordedBy: LEAD });
}

/**
 * The workbooks contain their own proofs. Each of these is an identity that
 * holds in the camp's own sheets, reproduced from database rows. They exist so
 * that a change which quietly breaks one of the camp's real totals fails here
 * rather than in front of a lead.
 *
 * This block asserts what the SEED alone produces, which is now less than it
 * was: the ledger and the ברן 26 camp budget belong to the promoter. Those
 * expected values are zero here, and that zero is a real gate — nothing
 * deduplicates a seeded row against a promoted one, so a regression that put
 * them back would double the season in front of a lead.
 *
 * The camp's own totals have not left CI with them. They are asserted in the
 * second block below, over rows the promoter writes from the workbook's cells,
 * and every figure this block used to carry is named where it went.
 */
describe('the workbooks own arithmetic', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await seedCampBaseline(db, LEAD);
  });

  /**
   * Was 62,000 in / 45,271 out / 16,729 net. Block
   * `6f1a7fc4-03ac-4ec3-abe4-0b5a863e133f` produces those twelve movements
   * now. Zero here is the assertion that the seed does not ALSO produce them:
   * nothing deduplicates a seeded row against a promoted one, so a regression
   * that put them back would double the season in front of a lead.
   */
  it('ברן 26 ledger: nothing seeded — block 6f1a7fc4 owns all twelve', async () => {
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    const totals = await ledgerTotals(db, { seasonId: s26.id });
    expect(totals.count).toBe(0);
    expect(totals.inAgorot).toBe(0);
    expect(totals.outAgorot).toBe(0);
    expect(totals.netAgorot).toBe(0);
  });

  /** Was 64,375.30, from twenty-four seeded `camp` lines. Block
   *  `66ad3b61-8b6c-4852-90a4-1cfe0b1f8a92` owns them now. */
  it('ברן 26 budget: nothing seeded — block 66ad3b61 owns all twenty-four', async () => {
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    expect(await budgetTotalAgorot(db, s26.id)).toBe(0);
  });

  it('ברן 26 fundraising plan: 135,375.30', async () => {
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    expect(await fundingTotalAgorot(db, s26.id)).toBe(13537530);
  });

  it('ברן 26 ticket projection: 171,000', async () => {
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    expect(await ticketTotalAgorot(db, s26.id)).toBe(17100000);
  });

  /**
   * Was: 1,200 + 639.29 = 1,839.29, and `closes` true.
   *
   * The funding half is untouched — `funding_targets` has no archetype in
   * `BLOCK_ARCHETYPES`, so the seed still owns all eight targets — and both of
   * its figures are still pinned here. The full per-head figure was the camp
   * budget divided by 35, and the camp budget is the promoter's, so it reads 0
   * and the identity does not close. That asymmetry is the assertion: if the
   * fundraising plan had been dropped along with the budget, 22,375.30 and
   * 639.29 would go to 0 too and this test would fail.
   */
  it('the dues/fundraising identity keeps its funding half: 1,200 + 639.29', async () => {
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    // Pinned directly, not only through the rounded per-head figure below —
    // the identity divides this by 35 before comparing, so a drift of a few
    // agorot in the seeded dues line would round away and pass unnoticed.
    expect(await campBudgetFundingAgorot(db, s26.id)).toBe(2237530);

    const identity = await duesFundingIdentity(db, s26.id);
    expect(identity.flatRateAgorot).toBe(120000);
    expect(identity.perPersonFundingAgorot).toBe(63929);
    expect(identity.perPersonFullAgorot).toBe(0);
    expect(identity.closes).toBe(false);
  });

  it('חוב יוסף: 15,240 − 14,330 = 910', async () => {
    const rows = await listObligations(db, { direction: 'camp_owes' });
    const yosef = rows.find((row) => row.description.includes('יוסף'))!;
    expect(yosef.amountAgorot).toBe(1524000);
    expect(yosef.settledAgorot).toBe(1433000);
    expect(yosef.outstandingAgorot).toBe(91000);
  });

  it('the twelve reimbursements sum to 5,954, the surprises budget line', async () => {
    const rows = await listObligations(db, { direction: 'camp_owes' });
    const reimbursements = rows.filter((row) => row.description !== 'חוב יוסף');
    expect(reimbursements).toHaveLength(12);
    expect(reimbursements.reduce((n, r) => n + r.amountAgorot, 0)).toBe(595400);

    // Length + sum alone would still miss a mutation that moves value between
    // two existing rows (drop 10 from one, add 10 to another) — count and
    // total both survive that untouched. Pinning the sorted multiset of
    // amounts closes that gap without hardcoding which name owns which figure.
    expect(reimbursements.map((r) => r.amountAgorot).sort((a, b) => a - b)).toEqual(
      [4000, 6500, 20000, 30000, 33500, 40000, 40000, 50000, 58000, 70900, 82000, 160500],
    );
  });

  it('two of them can never be closed, because nobody knows who is owed', async () => {
    const unnamed = await unnamedObligations(db);
    expect(unnamed).toHaveLength(2);
    expect(unnamed.every((row) => row.displayParty === null)).toBe(true);
  });

  /**
   * The workbook's ברן 25 sheet nets to 44,183.55 — but only because its
   * income column includes `מעבר לקובץ חדש 44,647`, the previous book's
   * closing balance. Under a continuous ledger that row is not income, so the
   * season nets to −463.45 and the 44,647 lives as an opening balance.
   *
   * This used to assert 50,306.55 in / 50,770 out / −463.45 net from seven
   * seeded rows, and then reconcile that net against the מיקום block. Block
   * `ac5a9d6e-8b52-40a9-bfea-a22771a2e4c6` produces the seven now, and refuses
   * the carry-forward row on its own rule (`carry-forward`), so the judgement
   * survives the seed losing it.
   *
   * What this test still holds is the other side of the same identity: the
   * מיקום openings must come to exactly 44,647 − 463.45. `accountBalances` is a
   * separate query over opening balances only, so a drift in any of the three
   * still fails here. The two halves meet, over promoted rows, in
   * `ברן 25 nets to −463.45 from promoted rows` in the block below.
   */
  it('ברן 25: the מיקום openings reconcile to −463.45 plus the 44,647 carry-forward', async () => {
    const s25 = (await getSeasonByName(db, 'ברן 25'))!;
    const totals = await ledgerTotals(db, { seasonId: s25.id });
    expect(totals.count).toBe(0);
    expect(totals.netAgorot).toBe(0);

    const mikomTotalAgorot = (await accountBalances(db))
      .reduce((n, row) => n + row.balanceAgorot, 0);
    expect(mikomTotalAgorot - 4464700).toBe(-46345);
  });

  /**
   * ברן 25's four רחבה deliverables are its only recorded budget lines —
   * 41,300 + 12,950 + 30,810 + 4,000 = 89,060, category `dancefloor` — and it
   * has no `camp` line at all. The identity must report that as no camp
   * budget recorded, not as the dancefloor total divided by the camp.
   */
  it('ברן 25 has a dancefloor budget but no camp budget, and the identity says so', async () => {
    const s25 = (await getSeasonByName(db, 'ברן 25'))!;
    expect(await budgetTotalAgorot(db, s25.id, 'dancefloor')).toBe(8906000);
    expect(await budgetTotalAgorot(db, s25.id, 'camp')).toBe(0);

    const identity = await duesFundingIdentity(db, s25.id);
    expect(identity.budgetTotalAgorot).toBe(0);
    expect(identity.perPersonFullAgorot).toBe(0);
    expect(identity.closes).toBe(false);
  });

  it('the מיקום block reproduces: 1,584 + 28,520 + 14,079.55 = 44,183.55', async () => {
    const balances = await accountBalances(db);
    const byName = new Map(balances.map((row) => [row.name, row.balanceAgorot]));
    expect(byName.get('קופת מזומן')).toBe(158400);
    expect(byName.get('וייבז קלוז פרינדס')).toBe(2852000);
    expect(byName.get('עו״ש אופק')).toBe(1407955);
    expect(balances.reduce((n, row) => n + row.balanceAgorot, 0)).toBe(4418355);
  });

  it('derives a balance rather than storing one', async () => {
    const balances = await accountBalances(db);
    const kupa = balances.find((row) => row.name === 'קופת מזומן')!;

    await recordEntry(db, {
      occurredOn: new Date('2026-09-01T00:00:00Z'), direction: 'out', amount: 84,
      description: 'בדיקה', accountId: kupa.accountId, recordedBy: LEAD,
    });

    const after = (await accountBalances(db))
      .find((row) => row.name === 'קופת מזומן')!;
    expect(after.balanceAgorot).toBe(kupa.balanceAgorot - 8400);

    // and the movement is visible in the ledger, not swallowed by a stored total
    const moves = await listMovements(db, { accountId: kupa.accountId });
    expect(moves.some((m) => m.description === 'בדיקה')).toBe(true);
  });
});

/**
 * The same four identities the seed used to prove, proved instead over rows
 * the promoter wrote — the state a database is in after `scripts/cutover.ts`.
 *
 * These are the camp's real numbers and they belong in CI, not only in a
 * scratch run somebody has to remember to do. Each is now a stronger gate than
 * the seeded version it replaces, because it fails if the promoter mis-parses
 * a cell, if it promotes a row it should refuse, or if the closure arithmetic
 * drifts — three ways to be wrong where there used to be one.
 *
 * The seed runs first, so the accounts, dues and funding targets it still owns
 * are present exactly as they are on the real database.
 *
 * `beforeAll`, not `beforeEach`, and deliberately: seeding and then promoting
 * three blocks through PGlite costs about twenty seconds, and every assertion
 * in this block is a pure read. Building the fixture once takes the file from
 * roughly two minutes back to roughly twenty seconds. If a test is ever added
 * here that WRITES, it needs its own database — put it in the block above,
 * which gets a fresh one per test.
 */
describe('the workbooks own arithmetic, once the promoter has read them', () => {
  let bulk: Awaited<ReturnType<typeof promoteTheWorkbook>>;

  beforeAll(async () => {
    db = await createTestDb();
    await seedCampBaseline(db, LEAD);
    bulk = await promoteTheWorkbook();
    // If a block ever stops promoting, every figure below would read 0 and the
    // failure would look like an arithmetic bug. Fail on the cause instead.
    expect(bulk.failedCount).toBe(0);
  });

  /** 62,000 in, 45,271 out, 16,729 net — twelve movements, from cells. */
  it('ברן 26 ledger: 62,000 in, 45,271 out, 16,729 net', async () => {
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    const totals = await ledgerTotals(db, { seasonId: s26.id });
    expect(totals.count).toBe(12);
    expect(totals.inAgorot).toBe(6200000);
    expect(totals.outAgorot).toBe(4527100);
    expect(totals.netAgorot).toBe(1672900);
  });

  /**
   * 64,375.30 over twenty-four lines.
   *
   * The count is asserted beside the sum because `מקרר + מקפיא` carries a 0:
   * a promoter that refused zero-amount rows would drop it and still total
   * 64,375.30, and the sum alone would never notice.
   */
  it('ברן 26 budget: 64,375.30 over twenty-four camp lines', async () => {
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    expect(await budgetTotalAgorot(db, s26.id, 'camp')).toBe(6437530);
    const { listBudgetLines } = await import('./budget');
    const lines = (await listBudgetLines(db, s26.id)).filter((l) => l.category === 'camp');
    expect(lines).toHaveLength(24);
    expect(lines.find((l) => l.label === 'מקרר + מקפיא')?.totalAgorot).toBe(0);
  });

  /**
   * The sentence no cell of any workbook states: 1,200 + 639.29 = 1,839.29.
   *
   * One half comes from the promoter (the budget) and the other from the seed
   * (the fundraising plan), which is exactly the post-cutover arrangement. It
   * closing is the proof that the cutover does not lose the relationship.
   */
  it('the dues/fundraising identity closes: 1,200 + 639.29 = 1,839.29', async () => {
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    expect(await campBudgetFundingAgorot(db, s26.id)).toBe(2237530);

    const identity = await duesFundingIdentity(db, s26.id);
    expect(identity.budgetTotalAgorot).toBe(6437530);
    expect(identity.flatRateAgorot).toBe(120000);
    expect(identity.perPersonFundingAgorot).toBe(63929);
    expect(identity.perPersonFullAgorot).toBe(183929);
    expect(identity.closes).toBe(true);
  });

  /**
   * ברן 25 nets to −463.45, and the 44,647 the workbook booked as income is
   * exactly what reconciles it to the מיקום block's own total.
   *
   * Both sides are live queries now: `ledgerTotals` over promoted rows and
   * `accountBalances` over the seeded openings, with 44,647 the one constant
   * that can never come from either — because it is precisely the row the
   * promoter refuses. A bad parse moves the left side, a drifted opening
   * balance moves the right, and only the `carry-forward` refusal keeps them
   * equal.
   */
  it('ברן 25 nets to −463.45 from promoted rows, and the 44,647 reconciles it', async () => {
    const s25 = (await getSeasonByName(db, 'ברן 25'))!;
    const totals = await ledgerTotals(db, { seasonId: s25.id });
    expect(totals.count).toBe(7);
    expect(totals.inAgorot).toBe(5030655);
    expect(totals.outAgorot).toBe(5077000);
    expect(totals.netAgorot).toBe(-46345);

    const mikomTotalAgorot = (await accountBalances(db))
      .reduce((n, row) => n + row.balanceAgorot, 0);
    expect(totals.netAgorot + 4464700).toBe(mikomTotalAgorot);
  });

  /** The carry-forward row was handed to the promoter and must come back as a
   *  refusal, not as 44,647 of income. Asserted on the refusal itself, so a
   *  promoter that silently dropped the row for some other reason — a blank
   *  date, say — would not pass for the right behaviour. */
  it('refuses מעבר לקובץ חדש as carry-forward rather than booking 44,647', async () => {
    const refusals = bulk.results.flatMap((result) => result.refused);
    const carried = refusals.filter((refusal) => refusal.reason === 'carry-forward');
    expect(carried).toHaveLength(1);
    expect(carried[0].cells).toContain('44647');

    const s25 = (await getSeasonByName(db, 'ברן 25'))!;
    const moves = await listMovements(db, { seasonId: s25.id });
    expect(moves.map((m) => m.description)).not.toContain('מעבר לקובץ חדש');
    expect(moves).toHaveLength(7);
  });
});
