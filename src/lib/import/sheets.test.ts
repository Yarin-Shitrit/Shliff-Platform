import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { uploads, sheets } from '@/db/schema/source';
import {
  setSheetSeason, setSheetAuthority, listSheets, sheetEligibility,
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
});
