import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { seasons } from '@/db/schema/camp';
import { sitePlanSnapshots, sitePlans } from '@/db/schema/site';
import type { EditorItem, EditorLine } from './editor/model';
import { applySiteOps, createPlan, loadDoc } from './plan';
import { restoreOps } from './editor/restore';
import {
  deleteSnapshot, listSnapshots, MAX_SNAPSHOTS_PER_PLAN, readSnapshot, snapshotContentRefusal, snapshotNameRefusal,
  takeSnapshot, type SnapshotContent,
} from './snapshots';

const LEAD = 'lead@shliff.camp';
const PLOT = { widthCm: 2600, depthCm: 2400, gridCm: 50 };
const PLAN_PLOT = { ...PLOT, northDeg: 0 };

const tentOf = (over: Partial<EditorItem> = {}): EditorItem => ({
  id: crypto.randomUUID(), kind: 'tent', label: 'אוהל 1', xCm: 100, yCm: 100,
  widthCm: 300, depthCm: 300, heightCm: null, insetCm: null, ropeAngleDeg: null, sort: 0,
  taskId: null, notes: null, facing: 0, locked: false, groupId: null, ...over,
});

const lineOf = (fromId: string, toId: string, over: Partial<EditorLine> = {}): EditorLine => ({
  id: crypto.randomUUID(), kind: 'water', label: 'צינור מים 1', fromId, toId, points: [], sort: 0, notes: null, ...over,
});

describe('site_plan_snapshots, the migration', () => {
  let db: TestDb;
  let planId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const [season] = await db.insert(seasons).values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    planId = await createPlan(db, season.id, PLOT, LEAD);
  });

  it('holds any number of named plans for a map, and none once the map is gone', async () => {
    const content = { plot: PLAN_PLOT, items: [], lines: [] };
    await db.insert(sitePlanSnapshots).values([{ planId, name: 'א', content }, { planId, name: 'ב', content }]);
    expect((await db.select().from(sitePlanSnapshots)).map((row) => row.name).sort()).toEqual(['א', 'ב']);
    await db.delete(sitePlans).where(eq(sitePlans.id, planId));
    expect(await db.select().from(sitePlanSnapshots)).toEqual([]);
  });
});

describe('a saved plan’s name and content', () => {
  it('needs a name that is not blank and not longer than 60 characters', () => {
    expect(snapshotNameRefusal('')).toBe('a saved plan must have a name');
    expect(snapshotNameRefusal('   ')).toBe('a saved plan must have a name');
    expect(snapshotNameRefusal(undefined)).toBe('a saved plan must have a name');
    expect(snapshotNameRefusal('א'.repeat(61))).toBe('a saved plan name must be at most 60 characters');
    expect(snapshotNameRefusal(` ${'א'.repeat(60)} `)).toBeNull();
  });

  it('checks every item as a new item, every line as a new line, and each line’s ends against the kept items', () => {
    const tank = tentOf({ kind: 'water' });
    const shower = tentOf({ kind: 'shower', xCm: 1000 });
    const ok: SnapshotContent = { plot: PLAN_PLOT, items: [tank, shower], lines: [lineOf(tank.id, shower.id)] };
    expect(snapshotContentRefusal(ok)).toBeNull();
    expect(snapshotContentRefusal(null)).toBe('a saved plan must hold a plot, its items and its lines');
    expect(snapshotContentRefusal({ plot: { widthCm: 1.5, depthCm: 1, gridCm: 1, northDeg: 0 }, items: [], lines: [] }))
      .toBe('a saved plan must hold a plot, its items and its lines');
    expect(snapshotContentRefusal({ ...ok, items: [tentOf({ label: ' ' })] })).toBe('an item must have a label');
    expect(snapshotContentRefusal({ ...ok, items: [tank, { ...shower, id: tank.id }] })).toBe('a saved plan names an item twice');
    expect(snapshotContentRefusal({ ...ok, lines: [lineOf(tank.id, crypto.randomUUID())] })).toBe('a line end is not an item on this map');
    expect(snapshotContentRefusal({ ...ok, items: [tank, tentOf({ id: shower.id })], lines: ok.lines }))
      .toBe('a water pipe joins only a drinking-water tank, a shower, a sink or a splitter');
    const twice = lineOf(tank.id, shower.id);
    expect(snapshotContentRefusal({ ...ok, lines: [twice, { ...twice }] })).toBe('a saved plan names a line twice');
  });
});

describe('saved plans', () => {
  let db: TestDb;
  let planId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const [season] = await db.insert(seasons).values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    planId = await createPlan(db, season.id, PLOT, LEAD);
  });

  it('keeps the map under a trimmed name, lists it newest first with what it holds, and reads it back whole', async () => {
    const tank = tentOf({ kind: 'water', label: ' מיכל ' , notes: ' ' });
    const shower = tentOf({ kind: 'shower', xCm: 1000, groupId: undefined });
    const pipe = lineOf(tank.id, shower.id, { points: [[500, 300]] });
    const first = await takeSnapshot(db, planId, '  סידור א  ', { plot: PLAN_PLOT, items: [tank, shower], lines: [pipe] }, LEAD);
    const second = await takeSnapshot(db, planId, 'סידור ב', { plot: { ...PLAN_PLOT, widthCm: 3000 }, items: [], lines: [] }, LEAD);

    const listed = await listSnapshots(db, planId);
    expect(listed.map((plan) => plan.id)).toEqual([second, first]);
    expect(listed[1]).toMatchObject({ name: 'סידור א', itemCount: 2, lineCount: 1, plot: PLAN_PLOT, createdBy: LEAD });
    expect(listed[0]).toMatchObject({ name: 'סידור ב', itemCount: 0, lineCount: 0, plot: { ...PLAN_PLOT, widthCm: 3000 } });
    expect(new Date(listed[1].createdAt).getTime()).not.toBeNaN();

    const read = await readSnapshot(db, first);
    expect(read?.planId).toBe(planId);
    // Stored as the editor's own shapes: the label trimmed, blank notes as none, and a group field on every item.
    expect(read?.items).toEqual([
      { ...tank, label: 'מיכל', notes: null },
      { ...shower, groupId: null },
    ]);
    expect(read?.lines).toEqual([pipe]);
    expect(await readSnapshot(db, crypto.randomUUID())).toBeNull();
  });

  it('refuses a blank name, a broken arrangement, an unknown map, and a thirty-first plan', async () => {
    const empty: SnapshotContent = { plot: PLAN_PLOT, items: [], lines: [] };
    await expect(takeSnapshot(db, planId, ' ', empty, LEAD)).rejects.toThrow('a saved plan must have a name');
    await expect(takeSnapshot(db, planId, 'א', { ...empty, items: [tentOf({ widthCm: 5 })] }, LEAD))
      .rejects.toThrow('an item side must be');
    await expect(takeSnapshot(db, crypto.randomUUID(), 'א', empty, LEAD)).rejects.toThrow('unknown site plan');
    for (let n = 0; n < MAX_SNAPSHOTS_PER_PLAN; n += 1) await takeSnapshot(db, planId, `תוכנית ${n + 1}`, empty, LEAD);
    await expect(takeSnapshot(db, planId, 'אחת יותר מדי', empty, LEAD)).rejects.toThrow('a map keeps at most 30 saved plans');
    expect((await listSnapshots(db, planId)).length).toBe(MAX_SNAPSHOTS_PER_PLAN);
  });

  it('forgets a plan and leaves the map alone; forgetting one that is gone says so', async () => {
    const tank = tentOf({ kind: 'water' });
    await applySiteOps(db, planId, 0, [{ type: 'add', item: tank }], LEAD);
    const id = await takeSnapshot(db, planId, 'א', { plot: PLAN_PLOT, items: [tank], lines: [] }, LEAD);
    await deleteSnapshot(db, id);
    expect(await listSnapshots(db, planId)).toEqual([]);
    expect((await loadDoc(db, planId))?.doc.items.map((item) => item.id)).toEqual([tank.id]);
    await expect(deleteSnapshot(db, id)).rejects.toThrow('unknown saved plan');
  });

  /*
   * End to end, the way the editor does it: the map is kept, changed, and
   * the kept plan loaded back — as ops through `applySiteOps`, against the
   * version — so what the server holds afterwards is the kept arrangement,
   * lines included, and the version moved on as any edit moves it.
   */
  it('loads back through the editor’s ops: the server’s map is the kept one afterwards', async () => {
    const tank = tentOf({ kind: 'water', label: 'מיכל' });
    const shower = tentOf({ kind: 'shower', xCm: 1000, label: 'מקלחת' });
    const pipe = lineOf(tank.id, shower.id);
    const saved = await applySiteOps(db, planId, 0, [
      { type: 'add', item: tank }, { type: 'add', item: shower }, { type: 'addLine', line: pipe },
    ], LEAD);
    expect(saved.status).toBe('saved');
    const kept = (await loadDoc(db, planId))!;
    const id = await takeSnapshot(db, planId, 'עם הצינור', { plot: PLAN_PLOT, items: kept.doc.items, lines: kept.doc.lines }, LEAD);

    // The lead changes their mind: the shower goes (its pipe with it), the tank moves, a tent arrives.
    const tent = tentOf({ xCm: 2000, label: 'אוהל' });
    const changed = await applySiteOps(db, planId, kept.version, [
      { type: 'removeLine', id: pipe.id }, { type: 'remove', id: shower.id },
      { type: 'update', id: tank.id, patch: { xCm: 400 } }, { type: 'add', item: tent },
    ], LEAD);
    expect(changed.status).toBe('saved');
    const now = (await loadDoc(db, planId))!;
    expect(now.doc.items.map((item) => item.label).sort()).toEqual(['אוהל', 'מיכל']);

    const plan = (await readSnapshot(db, id))!;
    const { ops, lockedNames, droppedLineNames } = restoreOps(now.doc, plan, new Set());
    expect(lockedNames).toEqual([]);
    expect(droppedLineNames).toEqual([]);
    const loaded = await applySiteOps(db, planId, now.version, ops, LEAD);
    expect(loaded).toEqual({ status: 'saved', version: now.version + 1, skipped: [] });

    const back = (await loadDoc(db, planId))!;
    expect(back.doc.items).toEqual(kept.doc.items);
    expect(back.doc.lines).toEqual(kept.doc.lines);
  });
});
