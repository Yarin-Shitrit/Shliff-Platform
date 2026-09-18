import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { persons, personAliases, seasons } from '@/db/schema/camp';
import { uploads, sheets, blocks } from '@/db/schema/source';
import { resolvedItems, clearedToday } from './resolved';

const NOW = new Date('2026-09-17T09:00:00Z');
let db: TestDb;

beforeEach(async () => { db = await createTestDb(); });

describe('resolvedItems', () => {
  it('reports a linked name with who linked it and when', async () => {
    const [person] = await db.insert(persons).values({ displayName: 'נועה לוי' }).returning();
    await db.insert(personAliases).values({
      personId: person.id, alias: 'נועה ל.', normalized: 'נועה ל.', source: 'import',
      confirmedBy: 'lead@shliff.test', confirmedAt: NOW,
    });

    const [item] = await resolvedItems(db);
    expect(item.kind).toBe('unlinked-name');
    expect(item.title).toBe('״נועה ל.״');
    expect(item.detail).toBe('קושר ל־נועה לוי');
    expect(item.decidedBy).toBe('lead@shliff.test');
    expect(item.decidedAt).toEqual(NOW);
  });

  it('reports an ignored name as set aside, not as linked', async () => {
    await db.insert(personAliases).values({
      personId: null, alias: 'סה"כ', normalized: 'סה"כ', source: 'import',
      confirmedBy: 'lead@shliff.test', confirmedAt: NOW,
    });
    const [item] = await resolvedItems(db);
    expect(item.detail).toBe('סומן כלא-אדם');
    expect(item.id).toMatch(/^name:/);
  });

  it('reports a sheet that now has a season with no date rather than a borrowed one', async () => {
    const [season] = await db.insert(seasons).values({
      name: 'ברן 26', year: 2026, flatRate: '1200.00', plannedSize: 35,
    }).returning();
    const [upload] = await db.insert(uploads).values({
      filename: 'קופת קאמפ 2026.xlsx', sha256: 'x', storageKey: 'k',
      sizeBytes: 1, uploadedBy: 'lead@shliff.test',
    }).returning();
    await db.insert(sheets).values({
      uploadId: upload.id, name: 'סיכום כללי', index: 0, rowCount: 20, colCount: 6,
      seasonId: season.id,
    });

    const [item] = await resolvedItems(db);
    expect(item.kind).toBe('sheet-season');
    expect(item.detail).toBe('שויך ל־ברן 26 · נקבע — התאריך לא נשמר');
    expect(item.decidedAt).toBeNull();
    expect(item.decidedBy).toBeNull();
  });

  // The brief reused the open item's title here — לגיליון ״X״ אין שנה — in a
  // list of decisions that have been made. The sheet has a season now, so the
  // line would be a false statement standing beside the sentence that
  // contradicts it. The id is what has to survive, and it does.
  it('does not title a settled sheet with the problem it no longer has', async () => {
    const [season] = await db.insert(seasons).values({
      name: 'ברן 26', year: 2026, flatRate: '1200.00', plannedSize: 35,
    }).returning();
    const [upload] = await db.insert(uploads).values({
      filename: 'f.xlsx', sha256: 'x', storageKey: 'k', sizeBytes: 1, uploadedBy: 'l@x',
    }).returning();
    const [row] = await db.insert(sheets).values({
      uploadId: upload.id, name: 'סיכום כללי', index: 0, rowCount: 20, colCount: 6,
      seasonId: season.id,
    }).returning();

    const [item] = await resolvedItems(db);
    expect(item.title).toBe('גיליון ״סיכום כללי״');
    expect(item.title).not.toContain('אין שנה');
    expect(item.id).toBe(`sheet-season:${row.id}`);
  });

  // No English reaches a Hebrew screen. The archetype is carried as data so
  // the screen can render plan 11's ARCHETYPE_LABELS, which is the one record
  // and lives in that lane.
  it('names a confirmed table in Hebrew and carries its archetype as data', async () => {
    const [upload] = await db.insert(uploads).values({
      filename: 'f.xlsx', sha256: 'x', storageKey: 'k', sizeBytes: 1, uploadedBy: 'l@x',
    }).returning();
    const [sheet] = await db.insert(sheets).values({
      uploadId: upload.id, name: 'תנועות קופה', index: 0, rowCount: 20, colCount: 6,
    }).returning();
    await db.insert(blocks).values({
      sheetId: sheet.id, top: 1, left: 1, bottom: 9, right: 4,
      archetype: 'ledger', confidence: '1.0000', headerRow: 1,
      fingerprint: null, pipelineVersion: 1, rawGrid: [['a']],
      confirmedBy: 'lead@shliff.test', confirmedAt: NOW,
    });

    const [item] = await resolvedItems(db);
    expect(item.kind).toBe('block-undecided');
    expect(item.detail).toBe('הסיווג אושר');
    expect(item.archetype).toBe('ledger');
    expect(item.detail).not.toMatch(/[A-Za-z]/);
  });

  it('puts the dated decisions first, newest first, and the undated ones last', async () => {
    const [season] = await db.insert(seasons).values({
      name: 'ברן 26', year: 2026, flatRate: '1200.00', plannedSize: 35,
    }).returning();
    const [upload] = await db.insert(uploads).values({
      filename: 'f.xlsx', sha256: 'x', storageKey: 'k', sizeBytes: 1, uploadedBy: 'l@x',
    }).returning();
    await db.insert(sheets).values({
      uploadId: upload.id, name: 'סיכום כללי', index: 0, rowCount: 20, colCount: 6,
      seasonId: season.id,
    });
    await db.insert(personAliases).values([
      { personId: null, alias: 'א', normalized: 'א', source: 'import', confirmedBy: 'l@x', confirmedAt: new Date('2026-09-10T09:00:00Z') },
      { personId: null, alias: 'ב', normalized: 'ב', source: 'import', confirmedBy: 'l@x', confirmedAt: new Date('2026-09-16T09:00:00Z') },
    ]);

    const items = await resolvedItems(db);
    expect(items.map((i) => i.title)).toEqual(['״ב״', '״א״', 'גיליון ״סיכום כללי״']);
  });

  it('honours the limit', async () => {
    await db.insert(personAliases).values(
      Array.from({ length: 5 }, (_, i) => ({
        personId: null, alias: `x${i}`, normalized: `x${i}`, source: 'import',
        confirmedBy: 'l@x', confirmedAt: new Date(NOW.getTime() - i * 1000),
      })),
    );
    expect(await resolvedItems(db, 2)).toHaveLength(2);
  });

  it('never returns a name still waiting for a decision', async () => {
    await db.insert(personAliases).values({
      personId: null, alias: 'נועה ל.', normalized: 'נועה ל.', source: 'import',
    });
    expect(await resolvedItems(db)).toEqual([]);
  });
});

describe('clearedToday', () => {
  it('counts only the decisions stamped today, and never an undated one', () => {
    const items = [
      { id: 'a', kind: 'unlinked-name' as const, title: '', detail: '', archetype: null, decidedBy: 'l', decidedAt: new Date('2026-09-17T06:00:00Z') },
      { id: 'b', kind: 'unlinked-name' as const, title: '', detail: '', archetype: null, decidedBy: 'l', decidedAt: new Date('2026-09-16T23:00:00Z') },
      { id: 'c', kind: 'sheet-season' as const, title: '', detail: '', archetype: null, decidedBy: null, decidedAt: null },
    ];
    expect(clearedToday(items, NOW)).toBe(1);
  });
});
