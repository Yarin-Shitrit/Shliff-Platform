import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { uploads, sheets } from '@/db/schema/source';
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

  it('two retired copies of the same sheet do not conflict with each other', async () => {
    const a = await addSheet('23.xlsx', 'תקציב קאמפ ברן 23');
    const b = await addSheet('24.xlsx', 'תקציב קאמפ ברן 23');
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
});
