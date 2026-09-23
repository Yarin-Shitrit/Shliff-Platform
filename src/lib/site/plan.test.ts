import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { seasons, tasks } from '@/db/schema/camp';
import {
  addItem, copyPlan, createPlan, deriveView, itemById, listItems, planForSeason,
  removeItem, seasonsWithPlans, setPlot, siteView, updateItem,
} from './plan';

const LEAD = 'lead@shliff.camp';
const PLOT = { widthCm: 2600, depthCm: 2400, gridCm: 50 };

describe('the camp map', () => {
  let db: TestDb;
  let s25: string;
  let s26: string;

  beforeEach(async () => {
    db = await createTestDb();
    const rows = await db.insert(seasons).values([
      { name: 'ברן 25', year: 2025, flatRate: '1500.00' },
      { name: 'ברן 26', year: 2026, flatRate: '1200.00' },
    ]).returning();
    s25 = rows[0].id;
    s26 = rows[1].id;
  });

  describe('the plot', () => {
    it('creates one map per season and refuses a second', async () => {
      const id = await createPlan(db, s26, PLOT, LEAD);
      expect((await planForSeason(db, s26))?.id).toBe(id);
      await expect(createPlan(db, s26, PLOT, LEAD)).rejects.toThrow('this season already has a map');
    });

    it('refuses a plot that is a typo', async () => {
      await expect(createPlan(db, s26, { ...PLOT, widthCm: 50 }, LEAD))
        .rejects.toThrow('a plot side must be');
      await expect(createPlan(db, s26, { ...PLOT, depthCm: 60_000 }, LEAD))
        .rejects.toThrow('a plot side must be');
      await expect(createPlan(db, s26, { ...PLOT, widthCm: 2600.5 }, LEAD))
        .rejects.toThrow('a plot side must be');
      await expect(createPlan(db, s26, { ...PLOT, gridCm: 5 }, LEAD))
        .rejects.toThrow('a grid step must be');
    });

    it('refuses a season that is not there', async () => {
      await expect(createPlan(db, '00000000-0000-4000-8000-000000000000', PLOT, LEAD))
        .rejects.toThrow('unknown season');
    });

    it('resizes without moving anything, and the view says who is now outside', async () => {
      const planId = await createPlan(db, s26, PLOT, LEAD);
      const tent = await addItem(db, planId, 'tent', LEAD);
      await updateItem(db, tent, { xCm: 2000, yCm: 2000 }, LEAD);

      await setPlot(db, planId, { widthCm: 1000, depthCm: 1000, gridCm: 100 }, LEAD);

      const view = await siteView(db, s26);
      expect(view?.plan.widthCm).toBe(1000);
      expect(view?.plan.gridCm).toBe(100);
      const row = view?.items.find((item) => item.id === tent);
      expect(row?.xCm).toBe(2000);
      expect(row?.outside).toBe(true);
      expect(view?.counts.outside).toBe(1);
    });
  });

  describe('items', () => {
    let planId: string;

    beforeEach(async () => {
      planId = await createPlan(db, s26, PLOT, LEAD);
    });

    it('drops a preset on the first free spot, numbered by kind, drawn on top', async () => {
      const first = await addItem(db, planId, 'tent', LEAD);
      const second = await addItem(db, planId, 'tent', LEAD);
      const sofa = await addItem(db, planId, 'sofa', LEAD);
      const rows = await listItems(db, planId);
      expect(rows.map((row) => [row.id, row.label, row.xCm, row.yCm, row.widthCm, row.depthCm, row.sort])).toEqual([
        [first, 'אוהל 1', 0, 0, 300, 300, 0],
        [second, 'אוהל 2', 300, 0, 300, 300, 1],
        [sofa, 'ספה 1', 600, 0, 200, 90, 2],
      ]);
    });

    it('gives a shade net its default inset and nothing else one', async () => {
      const net = await addItem(db, planId, 'shade', LEAD);
      const sofa = await addItem(db, planId, 'sofa', LEAD);
      expect((await itemById(db, net))?.insetCm).toBe(50);
      expect((await itemById(db, sofa))?.insetCm).toBeNull();
    });

    it('still lands when the plot is full, at the origin, and the view flags it', async () => {
      const wall = await addItem(db, planId, 'other', LEAD);
      await updateItem(db, wall, { widthCm: 2600, depthCm: 2400 }, LEAD);
      const tent = await addItem(db, planId, 'tent', LEAD);
      const view = await siteView(db, s26);
      const row = view?.items.find((item) => item.id === tent);
      expect([row?.xCm, row?.yCm]).toEqual([0, 0]);
      expect(row?.overlapping).toBe(true);
      expect(view?.counts.overlapPairs).toBe(1);
    });

    it('refuses a kind it does not know', async () => {
      await expect(addItem(db, planId, 'pool' as never, LEAD)).rejects.toThrow('unknown item kind');
    });

    it('moves, resizes and relabels through one patch', async () => {
      const id = await addItem(db, planId, 'sofa', LEAD);
      await updateItem(db, id, { xCm: 450, yCm: -50, widthCm: 250, label: ' ספה של רוני ' }, LEAD);
      const row = await itemById(db, id);
      expect(row?.xCm).toBe(450);
      expect(row?.yCm).toBe(-50);
      expect(row?.widthCm).toBe(250);
      expect(row?.depthCm).toBe(90);
      expect(row?.label).toBe('ספה של רוני');
      expect(row?.updatedBy).toBe(LEAD);
    });

    it('refuses a blank label, a sliver, and a fractional centimetre', async () => {
      const id = await addItem(db, planId, 'sofa', LEAD);
      await expect(updateItem(db, id, { label: '  ' }, LEAD)).rejects.toThrow('an item must have a label');
      await expect(updateItem(db, id, { widthCm: 5 }, LEAD)).rejects.toThrow('an item side must be');
      await expect(updateItem(db, id, { xCm: 12.5 }, LEAD)).rejects.toThrow('an item position must be');
      await expect(updateItem(db, id, { insetCm: -1 }, LEAD)).rejects.toThrow('a shade inset must be');
    });

    it('keeps the inset a fact about nets only', async () => {
      const id = await addItem(db, planId, 'sofa', LEAD);
      await updateItem(db, id, { kind: 'shade' }, LEAD);
      expect((await itemById(db, id))?.insetCm).toBe(50);
      await updateItem(db, id, { insetCm: 100 }, LEAD);
      expect((await itemById(db, id))?.insetCm).toBe(100);
      await updateItem(db, id, { kind: 'tent' }, LEAD);
      expect((await itemById(db, id))?.insetCm).toBeNull();
    });

    it('links only a build task of the same season', async () => {
      const [build] = await db.insert(tasks)
        .values({ seasonId: s26, kind: 'build', title: 'הקמת המטבח' }).returning();
      const [shift] = await db.insert(tasks)
        .values({ seasonId: s26, kind: 'shift', title: 'משמרת בר' }).returning();
      const [lastYear] = await db.insert(tasks)
        .values({ seasonId: s25, kind: 'build', title: 'הקמת המטבח 25' }).returning();

      const id = await addItem(db, planId, 'kitchen', LEAD);
      await updateItem(db, id, { taskId: build.id }, LEAD);
      expect((await itemById(db, id))?.taskTitle).toBe('הקמת המטבח');

      await expect(updateItem(db, id, { taskId: shift.id }, LEAD))
        .rejects.toThrow('that task is not a build task of this season');
      await expect(updateItem(db, id, { taskId: lastYear.id }, LEAD))
        .rejects.toThrow('that task is not a build task of this season');

      await updateItem(db, id, { taskId: null }, LEAD);
      expect((await itemById(db, id))?.taskId).toBeNull();
    });

    it('removes an item and refuses to remove it twice', async () => {
      const id = await addItem(db, planId, 'tent', LEAD);
      await removeItem(db, id);
      expect(await itemById(db, id)).toBeNull();
      await expect(removeItem(db, id)).rejects.toThrow('unknown site item');
      await expect(updateItem(db, id, { xCm: 0 }, LEAD)).rejects.toThrow('unknown site item');
    });
  });

  describe('copying last year', () => {
    it('copies the plot and the items, drops the task links, and refuses a second copy', async () => {
      const old = await createPlan(db, s25, { widthCm: 2000, depthCm: 2000, gridCm: 100 }, LEAD);
      const [build] = await db.insert(tasks)
        .values({ seasonId: s25, kind: 'build', title: 'הקמה' }).returning();
      const tent = await addItem(db, old, 'tent', LEAD);
      await updateItem(db, tent, { xCm: 1500, yCm: 1500, taskId: build.id }, LEAD);
      await addItem(db, old, 'shade', LEAD);

      const planId = await copyPlan(db, s25, s26, LEAD);
      const plan = await planForSeason(db, s26);
      expect(plan?.id).toBe(planId);
      expect([plan?.widthCm, plan?.depthCm, plan?.gridCm]).toEqual([2000, 2000, 100]);

      const rows = await listItems(db, planId);
      expect(rows.map((row) => [row.kind, row.xCm, row.yCm, row.insetCm, row.sort, row.taskId])).toEqual([
        ['tent', 1500, 1500, null, 0, null],
        ['shade', 0, 0, 50, 1, null],
      ]);

      await expect(copyPlan(db, s25, s26, LEAD)).rejects.toThrow('this season already has a map');
    });

    it('refuses to copy from a season with no map', async () => {
      await expect(copyPlan(db, s25, s26, LEAD)).rejects.toThrow('that season has no map to copy');
    });

    it('lists the seasons that have a map, newest first, with their item counts', async () => {
      await createPlan(db, s25, PLOT, LEAD);
      const newer = await createPlan(db, s26, PLOT, LEAD);
      await addItem(db, newer, 'tent', LEAD);
      expect(await seasonsWithPlans(db)).toEqual([
        { seasonId: s26, seasonName: 'ברן 26', items: 1 },
        { seasonId: s25, seasonName: 'ברן 25', items: 0 },
      ]);
    });
  });

  describe('the view', () => {
    it('is null for a season with no map', async () => {
      expect(await siteView(db, s26)).toBeNull();
    });

    it('derives shade, overlap and outside flags from the rows', async () => {
      const planId = await createPlan(db, s26, PLOT, LEAD);
      const net = await addItem(db, planId, 'shade', LEAD);
      const sofa = await addItem(db, planId, 'sofa', LEAD);
      await updateItem(db, sofa, { xCm: 200, yCm: 200 }, LEAD);
      const chair = await addItem(db, planId, 'armchair', LEAD);
      await updateItem(db, chair, { xCm: 0, yCm: 0 }, LEAD);
      const tent = await addItem(db, planId, 'tent', LEAD);
      await updateItem(db, tent, { xCm: 2500, yCm: 2500 }, LEAD);

      const view = deriveView((await planForSeason(db, s26))!, await listItems(db, planId));
      const byId = new Map(view.items.map((item) => [item.id, item]));
      expect(byId.get(net)?.shade).toBeNull();
      expect(byId.get(sofa)?.shade).toBe('shaded');
      expect(byId.get(chair)?.shade).toBe('partly');
      expect(byId.get(tent)?.shade).toBe('unshaded');
      expect(byId.get(tent)?.outside).toBe(true);
      expect(view.counts).toEqual({
        items: 4,
        outside: 1,
        overlapping: 0,
        overlapPairs: 0,
        plotAreaM2: 624,
        shade: { nets: 1, shaded: 1, partly: 1, unshaded: 1, shadedAreaM2: 49 },
      });
    });
  });
});
