import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { uploads, sheets, blocks, blockMappings } from '@/db/schema/source';
import { ledgerEntries } from '@/db/schema/money';
import { promoteBlock } from '@/lib/import/promote/promote';
import { budgetTotalAgorot } from '@/lib/money/budget';
import type { ColumnMapping } from '@/lib/classify/map-columns';
import {
  setSheetSeason, setSheetAuthority, listSheets, sheetEligibility,
  retireSheet, unretireSheet,
} from './sheets';

let db: TestDb;
let s25: string;
let s26: string;

async function addSheet(filename: string, name: string): Promise<string> {
  const [up] = await db.insert(uploads).values({
    filename, sha256: `${filename}-${name}`, storageKey: `k/${filename}-${name}`,
    sizeBytes: 1, uploadedBy: 'lead@shliff.test', status: 'committed',
  }).returning();
  const [sheet] = await db.insert(sheets).values({
    uploadId: up.id, name, index: 0, rowCount: 10, colCount: 5,
  }).returning();
  return sheet.id;
}

/** Gives `sheetId` one promoted `ledger_entries` row directly — a season-less
 *  promoted row is real (a ledger block promotes with a `null` season), so
 *  this deliberately does not go through `setSheetSeason` first. */
async function addOwnedRow(sheetId: string): Promise<void> {
  const [block] = await db.insert(blocks).values({
    sheetId, top: 1, left: 1, bottom: 2, right: 4,
    archetype: 'ledger', confidence: '1.0000', headerRow: 1, fingerprint: null,
    pipelineVersion: 1, rawGrid: [['תאריך', 'פירוט']],
  }).returning();
  await db.insert(ledgerEntries).values({
    occurredOn: new Date(), direction: 'out', amount: '100.00',
    description: 'רשומה מקודמת', recordedBy: 'lead@shliff.test',
    sourceBlockId: block.id, sourceRow: 1,
  });
}

const BUDGET_MAP: ColumnMapping[] = [
  { column: 1, field: 'item', confidence: 1 },
  { column: 2, field: 'quantity', confidence: 1 },
  { column: 3, field: 'unit_cost', confidence: 1 },
  { column: 4, field: 'total', confidence: 1 },
];

/** A single confirmed `budget_lines` block on `onSheet`, ready to promote —
 *  `total` in shekels (`'585.23'` → 58,523 agorot via `toAgorot`). */
async function addBudgetBlock(onSheet: string, total: string): Promise<string> {
  const grid = [
    ['סוג הוצאה', 'כמות', 'מחיר', 'עלות כוללת'],
    ['בסיס', '1', total, total],
  ];
  const [block] = await db.insert(blocks).values({
    sheetId: onSheet, top: 1, left: 1, bottom: 2, right: 4,
    archetype: 'budget_lines', confidence: '1.0000', headerRow: 1, fingerprint: null,
    pipelineVersion: 1, rawGrid: grid,
    confirmedBy: 'lead@shliff.test', confirmedAt: new Date(),
  }).returning();
  await db.insert(blockMappings).values({
    blockId: block.id, columnMap: BUDGET_MAP, source: 'admin',
  });
  return block.id;
}

beforeEach(async () => {
  db = await createTestDb();
  s25 = (await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500, plannedSize: 43 })).id;
  s26 = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35 })).id;
});

describe('sheet labelling', () => {
  it('stores a season set by hand and reports the season name', async () => {
    const id = await addSheet('25.xlsx', 'תקציב קאמפ ברן 25');
    await setSheetSeason(db, id, s25);
    const [row] = await listSheets(db);
    expect(row.seasonId).toBe(s25);
    expect(row.seasonName).toBe('ברן 25');
  });

  it('clears a season back to null', async () => {
    const id = await addSheet('25.xlsx', 'תקציב קאמפ ברן 25');
    await setSheetSeason(db, id, s25);
    await setSheetSeason(db, id, null);
    const [row] = await listSheets(db);
    expect(row.seasonId).toBeNull();
  });
});

describe('eligibility', () => {
  it('an uncontested sheet is eligible with no authority set', async () => {
    const id = await addSheet('26.xlsx', 'תקציב רחבה ברן 25');
    await setSheetSeason(db, id, s25);
    const map = await sheetEligibility(db);
    expect(map.get(id)?.state).toBe('eligible');
  });

  it('the same sheet name in two seasons is NOT a collision — both stay eligible', async () => {
    const a = await addSheet('25.xlsx', 'סיכום כללי');
    const b = await addSheet('2026.xlsx', 'סיכום כללי');
    await setSheetSeason(db, a, s25);
    await setSheetSeason(db, b, s26);
    const map = await sheetEligibility(db);
    expect(map.get(a)?.state).toBe('eligible');
    expect(map.get(b)?.state).toBe('eligible');
  });

  it('two differently-named sheets in the same season do not contest each other', async () => {
    const a = await addSheet('25.xlsx', 'סיכום כללי');
    const b = await addSheet('2026.xlsx', 'תקציב קאמפ ברן 26');
    await setSheetSeason(db, a, s26);
    await setSheetSeason(db, b, s26);
    const map = await sheetEligibility(db);
    expect(map.get(a)?.state).toBe('eligible');
    expect(map.get(a)?.contestedWith).toEqual([]);
    expect(map.get(b)?.state).toBe('eligible');
    expect(map.get(b)?.contestedWith).toEqual([]);
  });

  it('two differently-named sheets, one unlabelled, do not contest each other', async () => {
    const a = await addSheet('25.xlsx', 'סיכום כללי');
    const b = await addSheet('2026.xlsx', 'תקציב קאמפ ברן 26');
    await setSheetSeason(db, a, s26);
    // b keeps its default null seasonId — deliberately left unlabelled.
    const map = await sheetEligibility(db);
    expect(map.get(a)?.state).toBe('eligible');
    expect(map.get(a)?.contestedWith).toEqual([]);
    expect(map.get(b)?.state).toBe('eligible');
    expect(map.get(b)?.contestedWith).toEqual([]);
  });

  it('the same sheet name in one season with no choice made is undecided on both', async () => {
    const a = await addSheet('25.xlsx', 'תקציב קאמפ ברן 26');
    const b = await addSheet('2026.xlsx', 'תקציב קאמפ ברן 26');
    await setSheetSeason(db, a, s26);
    await setSheetSeason(db, b, s26);
    const map = await sheetEligibility(db);
    expect(map.get(a)?.state).toBe('undecided');
    expect(map.get(b)?.state).toBe('undecided');
    expect(map.get(a)?.contestedWith).toEqual([b]);
  });

  it('marking one copy authoritative makes it eligible and the other superseded', async () => {
    const a = await addSheet('25.xlsx', 'תקציב קאמפ ברן 26');
    const b = await addSheet('2026.xlsx', 'תקציב קאמפ ברן 26');
    await setSheetSeason(db, a, s26);
    await setSheetSeason(db, b, s26);
    await setSheetAuthority(db, b, true);
    const map = await sheetEligibility(db);
    expect(map.get(b)?.state).toBe('eligible');
    expect(map.get(a)?.state).toBe('superseded');
  });

  it('two copies both marked authoritative are ambiguous, and neither wins', async () => {
    const a = await addSheet('25.xlsx', 'תקציב קאמפ ברן 26');
    const b = await addSheet('2026.xlsx', 'תקציב קאמפ ברן 26');
    await setSheetSeason(db, a, s26);
    await setSheetSeason(db, b, s26);
    await setSheetAuthority(db, a, true);
    await setSheetAuthority(db, b, true);
    const map = await sheetEligibility(db);
    expect(map.get(a)?.state).toBe('ambiguous');
    expect(map.get(b)?.state).toBe('ambiguous');
  });

  /**
   * The wildcard case — a season-less sheet, which conflicts with every
   * same-named sheet regardless of year because neither side has said which
   * year it is — is what retirement suppresses. This is what the eight
   * closed-season sheets need: they have no season (that is why they are
   * retired), and without this a retired one would still pull every live,
   * same-named sheet into a permanent collision.
   */
  it('a retired, season-less sheet never conflicts with a live one via the wildcard (R44)', async () => {
    const a = await addSheet('23.xlsx', 'סיכום כללי');
    const b = await addSheet('2026.xlsx', 'סיכום כללי');
    await setSheetSeason(db, b, s26);
    // a stays season-less — retired precisely because no season exists.
    await retireSheet(db, a, 'lead@shliff.test');
    const map = await sheetEligibility(db);
    expect(map.get(b)?.state).toBe('eligible');
    expect(map.get(b)?.contestedWith).toEqual([]);
  });

  /**
   * An EXPLICIT contest — both sides name the same season — is different
   * from the wildcard case above, and must NOT be suppressed by retirement.
   * If it were, retiring the chosen copy of a real, resolved contest would
   * leave the loser reading `'eligible'` on nobody's decision — see
   * `promoteBlock — retiring an authoritative copy does not transfer
   * authority` in promote.test.ts for the money-doubling this prevents.
   */
  it('an explicit same-season contest survives retirement — a lead must still choose (R44)', async () => {
    const a = await addSheet('25.xlsx', 'סיכום כללי');
    const b = await addSheet('2026.xlsx', 'סיכום כללי');
    await setSheetSeason(db, a, s26);
    await setSheetSeason(db, b, s26);
    await retireSheet(db, a, 'lead@shliff.test');
    const map = await sheetEligibility(db);
    expect(map.get(b)?.state).toBe('undecided');
    expect(map.get(b)?.contestedWith).toEqual([a]);
  });

  /**
   * Both sheets share an explicit season here on purpose — without it,
   * `conflicts()`'s both-retired guard is not the thing making this pass:
   * the season-less case already falls through to the wildcard-suppression
   * line below it and returns false regardless, so deleting the
   * both-retired line would not fail this test. With an explicit shared
   * season, line 3 (`a.seasonId === b.seasonId` → conflict) WOULD fire if
   * the both-retired line above it were removed, so this pins it for real.
   */
  it('two retired copies of the same sheet, same season, do not conflict with each other', async () => {
    const a = await addSheet('23.xlsx', 'תקציב קאמפ ברן 23');
    const b = await addSheet('24.xlsx', 'תקציב קאמפ ברן 23');
    await setSheetSeason(db, a, s25);
    await setSheetSeason(db, b, s25);
    await retireSheet(db, a, 'lead@shliff.test');
    await retireSheet(db, b, 'lead@shliff.test');
    const map = await sheetEligibility(db);
    expect(map.get(a)?.contestedWith).toEqual([]);
    expect(map.get(b)?.contestedWith).toEqual([]);
  });

  it('an unlabelled sheet contests a same-named labelled one, and labelling it clears both', async () => {
    const a = await addSheet('25.xlsx', 'סיכום כללי');
    const b = await addSheet('2026.xlsx', 'סיכום כללי');
    await setSheetSeason(db, a, s25);
    expect((await sheetEligibility(db)).get(a)?.state).toBe('undecided');
    await setSheetSeason(db, b, s26);
    const map = await sheetEligibility(db);
    expect(map.get(a)?.state).toBe('eligible');
    expect(map.get(b)?.state).toBe('eligible');
  });
});

describe('authority guard', () => {
  it('marking an unlabelled sheet authoritative throws, and the row is unchanged', async () => {
    const id = await addSheet('25.xlsx', 'תקציב קאמפ ברן 26');
    await expect(setSheetAuthority(db, id, true)).rejects.toThrow();
    const [row] = await listSheets(db);
    expect(row.authoritative).toBeNull();
    expect(row.seasonId).toBeNull();
  });

  it('clearing authority on an unlabelled sheet succeeds', async () => {
    const id = await addSheet('25.xlsx', 'תקציב קאמפ ברן 26');
    await setSheetAuthority(db, id, false);
    let [row] = await listSheets(db);
    expect(row.authoritative).toBe(false);

    await setSheetAuthority(db, id, null);
    [row] = await listSheets(db);
    expect(row.authoritative).toBeNull();
  });

  it('clearing a season also clears authority', async () => {
    const id = await addSheet('25.xlsx', 'תקציב קאמפ ברן 26');
    await setSheetSeason(db, id, s26);
    await setSheetAuthority(db, id, true);
    await setSheetSeason(db, id, null);
    const [row] = await listSheets(db);
    expect(row.authoritative).toBeNull();
  });

  it('an unlabelled copy in a three-way name collision cannot be chosen, and labelling it into a third season clears all three', async () => {
    const a = await addSheet('25.xlsx', 'תקציב קאמפ ברן');
    const b = await addSheet('26.xlsx', 'תקציב קאמפ ברן');
    const c = await addSheet('27.xlsx', 'תקציב קאמפ ברן');
    await setSheetSeason(db, a, s25);
    await setSheetSeason(db, b, s26);
    // c stays unlabelled — it conflicts with both a and b via the null clause.
    await expect(setSheetAuthority(db, c, true)).rejects.toThrow();

    const s27 = (await createSeason(
      db, { name: 'ברן 27', year: 2027, flatRate: 1300, plannedSize: 30 },
    )).id;
    await setSheetSeason(db, c, s27);
    const map = await sheetEligibility(db);
    expect(map.get(a)?.state).toBe('eligible');
    expect(map.get(b)?.state).toBe('eligible');
    expect(map.get(c)?.state).toBe('eligible');
  });

  it('marking an unknown sheet authoritative throws a not-found error, not the season message', async () => {
    const unknownId = '00000000-0000-0000-0000-000000000000';
    await expect(setSheetAuthority(db, unknownId, true))
      .rejects.toThrow(`unknown sheet ${unknownId}`);
  });

  it('clearing authority (false) on an unknown sheet throws rather than silently no-oping', async () => {
    const unknownId = '00000000-0000-0000-0000-000000000000';
    await expect(setSheetAuthority(db, unknownId, false))
      .rejects.toThrow(`unknown sheet ${unknownId}`);
  });

  it('clearing authority (null) on an unknown sheet throws rather than silently no-oping', async () => {
    const unknownId = '00000000-0000-0000-0000-000000000000';
    await expect(setSheetAuthority(db, unknownId, null))
      .rejects.toThrow(`unknown sheet ${unknownId}`);
  });

  it('setting a season on an unknown sheet throws rather than silently succeeding', async () => {
    const unknownId = '00000000-0000-0000-0000-000000000000';
    await expect(setSheetSeason(db, unknownId, s25))
      .rejects.toThrow(`unknown sheet ${unknownId}`);
  });
});

describe('retirement', () => {
  it('retireSheet stamps both columns', async () => {
    const id = await addSheet('23.xlsx', 'תקציב קאמפ ברן 23');
    await retireSheet(db, id, 'lead@shliff.test');
    const [row] = await listSheets(db);
    expect(row.retiredAt).not.toBeNull();
    expect(row.retiredBy).toBe('lead@shliff.test');
  });

  it('unretireSheet clears both columns', async () => {
    const id = await addSheet('23.xlsx', 'תקציב קאמפ ברן 23');
    await retireSheet(db, id, 'lead@shliff.test');
    await unretireSheet(db, id);
    const [row] = await listSheets(db);
    expect(row.retiredAt).toBeNull();
    expect(row.retiredBy).toBeNull();
  });

  it('retiring an unknown sheet refuses rather than silently no-oping', async () => {
    const unknownId = '00000000-0000-0000-0000-000000000000';
    await expect(retireSheet(db, unknownId, 'lead@shliff.test'))
      .rejects.toThrow(`unknown sheet ${unknownId}`);
  });

  it('unretiring an unknown sheet refuses rather than silently no-oping', async () => {
    const unknownId = '00000000-0000-0000-0000-000000000000';
    await expect(unretireSheet(db, unknownId))
      .rejects.toThrow(`unknown sheet ${unknownId}`);
  });

  it('retirement is orthogonal to season and authority — a retired sheet keeps both', async () => {
    const id = await addSheet('26.xlsx', 'תקציב קאמפ ברן 26');
    await setSheetSeason(db, id, s26);
    await setSheetAuthority(db, id, true);
    await retireSheet(db, id, 'lead@shliff.test');
    const [row] = await listSheets(db);
    expect(row.seasonId).toBe(s26);
    expect(row.authoritative).toBe(true);
  });

  it('a retired sheet with no season stays exactly that — retiring records the fact, not a season', async () => {
    const id = await addSheet('23.xlsx', 'תקציב קאמפ ברן 23');
    await retireSheet(db, id, 'lead@shliff.test');
    const [row] = await listSheets(db);
    expect(row.seasonId).toBeNull();
    expect(row.retiredAt).not.toBeNull();
  });

  /**
   * The allow-path R53's guard must never close off: this IS the eight
   * closed-season ברן 23'/24' sheets the whole feature exists for — a live,
   * labelled sheet sharing a name with a retired, SEASON-LESS copy that
   * still owns rows from before this feature existed. `conflicts()` never
   * treats a season-less retired sheet as a rival of a labelled live one
   * (only an EXPLICIT same-season match survives retirement — see
   * `conflicts()`'s own comment), so `refuseIfRetiredRivalOwnsRows` never
   * even looks at this retired sheet's rows, and the live one may be marked
   * authoritative freely. A version of the guard that matched by `name`
   * alone, instead of going through `conflicts()`, would refuse this and
   * silently start blocking the exact case R53 must not touch.
   */
  it('allows a live sheet to become authoritative even though a retired, season-less, same-named rival owns rows', async () => {
    const live = await addSheet('26.xlsx', 'תקציב קאמפ');
    await setSheetSeason(db, live, s26);

    const retired = await addSheet('23.xlsx', 'תקציב קאמפ'); // no season, like the real ברן 23/24 sheets
    await retireSheet(db, retired, 'lead@shliff.test');
    const [block] = await db.insert(blocks).values({
      sheetId: retired, top: 1, left: 1, bottom: 2, right: 4,
      archetype: 'ledger', confidence: '1.0000', headerRow: 1, fingerprint: null,
      pipelineVersion: 1, rawGrid: [['תאריך', 'פירוט']],
    }).returning();
    await db.insert(ledgerEntries).values({
      occurredOn: new Date(), direction: 'out', amount: '100.00',
      description: 'רשומה מלפני הפרישה', recordedBy: 'lead@shliff.test',
      sourceBlockId: block.id, sourceRow: 1,
    });

    await expect(setSheetAuthority(db, live, true)).resolves.toBeUndefined();
    const rows = await listSheets(db);
    expect(rows.find((r) => r.id === live)?.authoritative).toBe(true);
  });
});

describe('season guard — a sheet that owns promoted rows refuses a season change (R54)', () => {
  it('refuses a change to a different season, in Hebrew, and leaves the season unchanged', async () => {
    const id = await addSheet('26.xlsx', 'תקציב קאמפ ברן 26');
    await setSheetSeason(db, id, s26);
    await addOwnedRow(id);

    let message = '';
    try {
      await setSheetSeason(db, id, s25);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/[֐-׿]/);
    expect(message).not.toMatch(/[a-zA-Z]/);

    const [row] = await listSheets(db);
    expect(row.seasonId).toBe(s26);
  });

  it('refuses clearing to null, and does not clear authority either', async () => {
    const id = await addSheet('26.xlsx', 'תקציב קאמפ ברן 26');
    await setSheetSeason(db, id, s26);
    await setSheetAuthority(db, id, true);
    await addOwnedRow(id);

    await expect(setSheetSeason(db, id, null)).rejects.toThrow();

    const [row] = await listSheets(db);
    expect(row.seasonId).toBe(s26);
    expect(row.authoritative).toBe(true);
  });

  it('allows a no-op — setting the same season it already has', async () => {
    const id = await addSheet('26.xlsx', 'תקציב קאמפ ברן 26');
    await setSheetSeason(db, id, s26);
    await addOwnedRow(id);

    await expect(setSheetSeason(db, id, s26)).resolves.toBeUndefined();
    const [row] = await listSheets(db);
    expect(row.seasonId).toBe(s26);
  });

  it('owning no rows: every change is still allowed, including clear-also-clears-authority', async () => {
    const id = await addSheet('26.xlsx', 'תקציב קאמפ ברן 26');
    await setSheetSeason(db, id, s26);
    await setSheetAuthority(db, id, true);

    await expect(setSheetSeason(db, id, s25)).resolves.toBeUndefined();
    let [row] = await listSheets(db);
    expect(row.seasonId).toBe(s25);

    await expect(setSheetSeason(db, id, null)).resolves.toBeUndefined();
    [row] = await listSheets(db);
    expect(row.seasonId).toBeNull();
    expect(row.authoritative).toBeNull();
  });

  it('refuses setting a season on a season-less sheet that already owns rows (the ledger case)', async () => {
    const id = await addSheet('23.xlsx', 'תקציב קאמפ ברן 23');
    // id stays season-less on purpose — a ledger block promotes with a null
    // season, so "no season yet" does not mean "owns no rows".
    await addOwnedRow(id);

    await expect(setSheetSeason(db, id, s26)).rejects.toThrow();
    const [row] = await listSheets(db);
    expect(row.seasonId).toBeNull();
  });

  /**
   * The original defect, reproduced end to end: `a` is chosen and promoted
   * first (58,523 agorot). Without the guard, moving `a` to a different
   * season stops `conflicts()` from seeing `b` as a rival, so `b` reads
   * `eligible` and promoting it INSERTs a second copy of the same money
   * (117,046 = 58,523 × 2). The throw alone does not pin this — a guard that
   * only checked the wrong direction, or only checked clearing, would still
   * let this double-count through, which is exactly what the money
   * assertion below catches and the two "must fail" mutations confirm.
   */
  it('the money assertion: the guard prevents a double-counted budget line', async () => {
    const a = await addSheet('25.xlsx', 'תקציב קאמפ ברן');
    const b = await addSheet('26.xlsx', 'תקציב קאמפ ברן');
    await setSheetSeason(db, a, s26);
    await setSheetSeason(db, b, s26);
    await setSheetAuthority(db, a, true);

    const blockA = await addBudgetBlock(a, '585.23');
    await promoteBlock(db, blockA, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(await budgetTotalAgorot(db, s26)).toBe(58523);

    // The lead tries to move a's season now that it owns a promoted row.
    await expect(setSheetSeason(db, a, s25)).rejects.toThrow();

    // Even after choosing b too, a's rival contest still stands (a's season
    // never moved), so b's own promotion cannot land a second copy.
    await setSheetAuthority(db, b, true);
    const blockB = await addBudgetBlock(b, '585.23');
    await promoteBlock(db, blockB, { dryRun: false, recordedBy: 'lead@shliff.test' });

    expect(await budgetTotalAgorot(db, s26)).toBe(58523);
    expect(await budgetTotalAgorot(db, s26)).not.toBe(117046);
  });
});
