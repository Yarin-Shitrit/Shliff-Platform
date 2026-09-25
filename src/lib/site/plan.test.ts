import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { seasons, tasks } from '@/db/schema/camp';
import { siteItems, siteKindDefaults } from '@/db/schema/site';
import {
  applySiteOps, copyPlan, createPlan, deriveView, itemById, kindDefaults, listItems, loadDoc,
  planById, planForSeason, seasonsWithPlans, setPlot, siteView,
} from './plan';
import type { EditorItem } from './editor/model';
import type { ItemPatch } from './editor/ops';

const LEAD = 'lead@shliff.camp';
const PLOT = { widthCm: 2600, depthCm: 2400, gridCm: 50 };

/** An item as the editor sends it; a 3 × 3 m tent unless told otherwise. */
const tentOf = (over: Partial<EditorItem> = {}): EditorItem => ({
  id: crypto.randomUUID(), kind: 'tent', label: 'אוהל 1', xCm: 100, yCm: 100,
  widthCm: 300, depthCm: 300, heightCm: null, insetCm: null, sort: 0,
  taskId: null, notes: null, locked: false, ...over,
});

/*
 * C1 (final review): the board wrote items through `addItem`, `updateItem`
 * and `removeItem`, which bumped no version and ignored locks — so a board
 * edit and an editor edit could overwrite each other silently. They retired
 * with the board (Task 26): every item write is a batch through
 * `applySiteOps`, against the version it read, refusing a locked item.
 */
describe('the camp map’s one way to write an item', () => {
  it('is a saved batch — no write that skips the version or a lock is left', async () => {
    const plan = await import('./plan');
    expect(Object.keys(plan).filter((name) => /Item$/.test(name) && !/^(itemById|toEditorItem)$/.test(name)))
      .toEqual([]);
    // The instrument reads the module: the readers are there.
    expect(Object.keys(plan)).toEqual(expect.arrayContaining(['applySiteOps', 'itemById', 'listItems']));
  });

  /** Every source file under `dirs`, as a forward-slash path from the repo root; test files and test helpers are fixtures, not writers. */
  function sources(dirs: string[]): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx|mts|mjs)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(path);
      }
    };
    for (const dir of dirs) walk(join(process.cwd(), dir));
    return found
      .map((path) => relative(process.cwd(), path).split(sep).join('/'))
      .filter((path) => !path.startsWith('src/test/'));
  }

  /* A name check misses a write added under a new name. This reads the code:
     every write to site_items in the app, the libraries and the scripts (which
     write the production database) sits inside `applySiteOps` — versioned,
     refusing a locked item — or `copyPlan`, which fills a map created a line
     before it, one nobody can have open yet. */
  it('writes site_items only from applySiteOps and copyPlan — nowhere else in the code or the scripts', () => {
    const writes: string[] = [];
    for (const file of sources(['src', 'scripts'])) {
      let current = '(top level)';
      readFileSync(join(process.cwd(), file), 'utf8').split('\n').forEach((line) => {
        const declared = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/.exec(line);
        if (declared) current = declared[1];
        if (/\.(insert|update|delete)\(\s*siteItems\s*\)/.test(line)
          || /\b(insert\s+into|update|delete\s+from)\s+"?site_items\b/i.test(line)) {
          writes.push(`${file}:${current}`);
        }
      });
    }
    // The instrument is reading: plan.ts's own writes are found — one in copyPlan, three in applySiteOps.
    expect(writes.length).toBe(4);
    expect([...new Set(writes)].sort()).toEqual(['src/lib/site/plan.ts:applySiteOps', 'src/lib/site/plan.ts:copyPlan']);
  });
});

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

  /** Puts items on a map the way the editor does: one saved batch, against the map's current version. */
  async function seed(planId: string, ...items: EditorItem[]): Promise<void> {
    const plan = await planById(db, planId);
    if (plan === null) throw new Error(`no map ${planId}`);
    const result = await applySiteOps(db, planId, plan.version, items.map((item) => ({ type: 'add' as const, item })), LEAD);
    expect(result).toEqual({ status: 'saved', version: plan.version + 1 });
  }

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
      const tent = tentOf({ xCm: 2000, yCm: 2000 });
      await seed(planId, tent);

      await setPlot(db, planId, { widthCm: 1000, depthCm: 1000, gridCm: 100 }, LEAD);

      const view = await siteView(db, s26);
      expect(view?.plan.widthCm).toBe(1000);
      expect(view?.plan.gridCm).toBe(100);
      const row = view?.items.find((item) => item.id === tent.id);
      expect(row?.xCm).toBe(2000);
      expect(row?.outside).toBe(true);
      expect(view?.counts.outside).toBe(1);
    });

    it('bumps the version when the plot changes, like a saved batch of edits', async () => {
      const planId = await createPlan(db, s26, PLOT, LEAD);
      await setPlot(db, planId, { widthCm: 1000, depthCm: 1000, gridCm: 100 }, LEAD);
      expect((await planForSeason(db, s26))?.version).toBe(1);
    });
  });

  /* The refusals the board's own writes held, on the one path left: a batch
     (`applySiteOps`). Each batch is against the version the one before it
     left; a refused batch writes nothing and moves no version. */
  describe('items', () => {
    let planId: string;
    const sofaOf = () => tentOf({ kind: 'sofa', label: 'ספה 1', widthCm: 200, depthCm: 90 });
    const update = (version: number, id: string, patch: ItemPatch) =>
      applySiteOps(db, planId, version, [{ type: 'update', id, patch }], LEAD);

    beforeEach(async () => {
      planId = await createPlan(db, s26, PLOT, LEAD);
    });

    it('refuses a kind it does not know', async () => {
      await expect(applySiteOps(db, planId, 0, [{ type: 'add', item: tentOf({ kind: 'pool' as never }) }], LEAD))
        .rejects.toThrow('unknown item kind');
      expect(await listItems(db, planId)).toEqual([]);
    });

    it('moves, resizes and relabels through one patch', async () => {
      const sofa = sofaOf();
      await seed(planId, sofa);
      await update(1, sofa.id, { xCm: 450, yCm: -50, widthCm: 250, label: ' ספה של רוני ' });
      const row = await itemById(db, sofa.id);
      expect(row?.xCm).toBe(450);
      expect(row?.yCm).toBe(-50);
      expect(row?.widthCm).toBe(250);
      expect(row?.depthCm).toBe(90);
      expect(row?.label).toBe('ספה של רוני');
      expect(row?.updatedBy).toBe(LEAD);
    });

    it('refuses a blank label, a sliver, a fractional centimetre and a negative inset', async () => {
      const sofa = sofaOf();
      await seed(planId, sofa);
      await expect(update(1, sofa.id, { label: '  ' })).rejects.toThrow('an item must have a label');
      // A label made only of an RLM mark looks empty on an RTL screen but survives `.trim()`.
      await expect(update(1, sofa.id, { label: '‏' })).rejects.toThrow('an item must have a label');
      await expect(update(1, sofa.id, { widthCm: 5 })).rejects.toThrow('an item side must be');
      await expect(update(1, sofa.id, { xCm: 12.5 })).rejects.toThrow('an item position must be');
      await expect(update(1, sofa.id, { insetCm: -1 })).rejects.toThrow('a shade inset must be');
      expect(await itemById(db, sofa.id)).toMatchObject({ label: 'ספה 1', widthCm: 200, xCm: 100, insetCm: null });
      expect((await planForSeason(db, s26))?.version).toBe(1);
    });

    it('keeps the inset a fact about nets only', async () => {
      const sofa = sofaOf();
      await seed(planId, sofa);
      await update(1, sofa.id, { kind: 'shade' });
      expect((await itemById(db, sofa.id))?.insetCm).toBe(50);
      await update(2, sofa.id, { insetCm: 100 });
      expect((await itemById(db, sofa.id))?.insetCm).toBe(100);
      await update(3, sofa.id, { kind: 'tent' });
      expect((await itemById(db, sofa.id))?.insetCm).toBeNull();
    });

    it('links only a build task of the same season, and unlinks', async () => {
      const [build] = await db.insert(tasks)
        .values({ seasonId: s26, kind: 'build', title: 'הקמת המטבח' }).returning();
      const [shift] = await db.insert(tasks)
        .values({ seasonId: s26, kind: 'shift', title: 'משמרת בר' }).returning();
      const [lastYear] = await db.insert(tasks)
        .values({ seasonId: s25, kind: 'build', title: 'הקמת המטבח 25' }).returning();

      const kitchen = tentOf({ kind: 'kitchen', label: 'מטבח 1' });
      await seed(planId, kitchen);
      await update(1, kitchen.id, { taskId: build.id });
      expect((await itemById(db, kitchen.id))?.taskTitle).toBe('הקמת המטבח');

      await expect(update(2, kitchen.id, { taskId: shift.id }))
        .rejects.toThrow('that task is not a build task of this season');
      await expect(update(2, kitchen.id, { taskId: lastYear.id }))
        .rejects.toThrow('that task is not a build task of this season');

      await update(2, kitchen.id, { taskId: null });
      expect((await itemById(db, kitchen.id))?.taskId).toBeNull();
    });

    it('removes an item, and refuses to remove or change it once it is gone', async () => {
      const tent = tentOf();
      await seed(planId, tent);
      await applySiteOps(db, planId, 1, [{ type: 'remove', id: tent.id }], LEAD);
      expect(await itemById(db, tent.id)).toBeNull();
      await expect(applySiteOps(db, planId, 2, [{ type: 'remove', id: tent.id }], LEAD))
        .rejects.toThrow('unknown site item');
      await expect(update(2, tent.id, { xCm: 0 })).rejects.toThrow('unknown site item');
    });
  });

  describe('copying last year', () => {
    it('copies the plot and the items, drops the task links, and refuses a second copy', async () => {
      const old = await createPlan(db, s25, { widthCm: 2000, depthCm: 2000, gridCm: 100 }, LEAD);
      const [build] = await db.insert(tasks)
        .values({ seasonId: s25, kind: 'build', title: 'הקמה' }).returning();
      await seed(
        old,
        tentOf({ xCm: 1500, yCm: 1500, taskId: build.id, sort: 0 }),
        // A net sent with no inset gets the default one.
        tentOf({ kind: 'shade', label: 'רשת צל 1', xCm: 0, yCm: 0, widthCm: 800, depthCm: 800, sort: 1 }),
      );

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
      await seed(newer, tentOf());
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
      // An 8 × 8 m net shading 7 × 7 m (50 cm in from each side), a sofa under it,
      // an armchair on its unshaded edge, and a tent past the fence.
      const net = tentOf({ kind: 'shade', label: 'רשת צל 1', xCm: 0, yCm: 0, widthCm: 800, depthCm: 800, sort: 0 });
      const sofa = tentOf({ kind: 'sofa', label: 'ספה 1', xCm: 200, yCm: 200, widthCm: 200, depthCm: 90, sort: 1 });
      const chair = tentOf({ kind: 'armchair', label: 'כורסה 1', xCm: 0, yCm: 0, widthCm: 90, depthCm: 90, sort: 2 });
      const tent = tentOf({ xCm: 2500, yCm: 2500, sort: 3 });
      await seed(planId, net, sofa, chair, tent);

      const view = deriveView((await planForSeason(db, s26))!, await listItems(db, planId));
      const byId = new Map(view.items.map((item) => [item.id, item]));
      expect(byId.get(net.id)?.shade).toBeNull();
      expect(byId.get(sofa.id)?.shade).toBe('shaded');
      expect(byId.get(chair.id)?.shade).toBe('partly');
      expect(byId.get(tent.id)?.shade).toBe('unshaded');
      expect(byId.get(tent.id)?.outside).toBe(true);
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

  describe('the 3D editor’s fields', () => {
    it('starts a plan at version 0 with north up, and takes a north when given', async () => {
      await createPlan(db, s26, { ...PLOT, northDeg: 15 }, LEAD);
      const plan = await planForSeason(db, s26);
      expect(plan?.version).toBe(0);
      expect(plan?.northDeg).toBe(15);
    });

    it('refuses a north that is not a whole degree from 0 to 359', async () => {
      await expect(createPlan(db, s26, { ...PLOT, northDeg: 360 }, LEAD)).rejects.toThrow('north must be');
      await expect(createPlan(db, s26, { ...PLOT, northDeg: 12.5 }, LEAD)).rejects.toThrow('north must be');
    });

    it('lists items with their own height and their lock', async () => {
      const planId = await createPlan(db, s26, PLOT, LEAD);
      const tent = tentOf();
      await seed(planId, tent);
      await db.update(siteItems).set({ heightCm: 180, locked: true }).where(eq(siteItems.id, tent.id));
      const [row] = await listItems(db, planId);
      expect(row).toMatchObject({ heightCm: 180, locked: true });
    });

    it('copies height and north, and does not copy a lock', async () => {
      const from = await createPlan(db, s25, { ...PLOT, northDeg: 30 }, LEAD);
      const caravan = tentOf({ kind: 'caravan', label: 'קראוון 1', widthCm: 700, depthCm: 250 });
      await seed(from, caravan);
      await db.update(siteItems).set({ heightCm: 260, locked: true }).where(eq(siteItems.id, caravan.id));

      const to = await copyPlan(db, s25, s26, LEAD);

      expect((await planForSeason(db, s26))?.northDeg).toBe(30);
      const [copy] = await listItems(db, to);
      expect(copy).toMatchObject({ heightCm: 260, locked: false });
    });

    it('reads the camp’s kind defaults, ignoring a kind the map no longer knows', async () => {
      await db.insert(siteKindDefaults).values([
        { kind: 'tent', widthCm: 350, depthCm: 300, heightCm: 210 },
        { kind: 'spaceship' as never, widthCm: 100, depthCm: 100, heightCm: 100 },
      ]);
      expect(await kindDefaults(db)).toEqual({ tent: { widthCm: 350, depthCm: 300, heightCm: 210, insetCm: null } });
    });

    it('loads one document for the editor', async () => {
      const planId = await createPlan(db, s26, { ...PLOT, northDeg: 10 }, LEAD);
      const sofa = tentOf({ kind: 'sofa', label: 'ספה 1', widthCm: 200, depthCm: 90 });
      const { id } = sofa;
      await seed(planId, sofa);
      const loaded = await loadDoc(db, planId);
      // The batch that put the sofa there moved the version on.
      expect(loaded?.version).toBe(1);
      expect(loaded?.doc.plot).toEqual({ id: planId, widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 10 });
      expect(loaded?.doc.items).toEqual([expect.objectContaining({
        id, kind: 'sofa', label: 'ספה 1', heightCm: null, locked: false, taskId: null, notes: null,
      })]);
      expect(loaded?.doc.defaults).toEqual({});
      expect(await loadDoc(db, '00000000-0000-4000-8000-000000000000')).toBeNull();
    });
  });

  describe('saving a batch of edits', () => {
    it('applies every op, bumps the version and returns it', async () => {
      const planId = await createPlan(db, s26, PLOT, LEAD);
      const tent = tentOf();
      const result = await applySiteOps(db, planId, 0, [
        { type: 'add', item: tent },
        { type: 'update', id: tent.id, patch: { xCm: 400, heightCm: 180 } },
        { type: 'setKindDefault', kind: 'tent', size: { widthCm: 350, depthCm: 300, heightCm: 210, insetCm: null } },
      ], LEAD);

      expect(result).toEqual({ status: 'saved', version: 1 });
      const [row] = await listItems(db, planId);
      expect(row).toMatchObject({ id: tent.id, xCm: 400, heightCm: 180, sort: 0 });
      expect(await kindDefaults(db)).toEqual({ tent: { widthCm: 350, depthCm: 300, heightCm: 210, insetCm: null } });
      expect((await planForSeason(db, s26))?.version).toBe(1);
    });

    it('answers a stale version with the current one and writes nothing', async () => {
      const planId = await createPlan(db, s26, PLOT, LEAD);
      await applySiteOps(db, planId, 0, [{ type: 'add', item: tentOf() }], LEAD);
      const result = await applySiteOps(db, planId, 0, [{ type: 'add', item: tentOf() }], LEAD);
      expect(result).toEqual({ status: 'conflict', version: 1 });
      expect(await listItems(db, planId)).toHaveLength(1);
    });

    it('refuses a batch whole when one op is bad', async () => {
      const planId = await createPlan(db, s26, PLOT, LEAD);
      const tent = tentOf();
      await expect(applySiteOps(db, planId, 0, [
        { type: 'add', item: tent },
        { type: 'update', id: tent.id, patch: { widthCm: 5 } },
      ], LEAD)).rejects.toThrow('an item side must be');
      expect(await listItems(db, planId)).toEqual([]);
      expect((await planForSeason(db, s26))?.version).toBe(0);
    });

    it('refuses an item that belongs to another season’s map', async () => {
      const mine = await createPlan(db, s26, PLOT, LEAD);
      const theirs = await createPlan(db, s25, PLOT, LEAD);
      const other = tentOf();
      await seed(theirs, other);
      await expect(applySiteOps(db, mine, 0, [{ type: 'remove', id: other.id }], LEAD))
        .rejects.toThrow('unknown site item');
    });

    it('refuses an id that is already taken', async () => {
      const planId = await createPlan(db, s26, PLOT, LEAD);
      const tent = tentOf();
      await applySiteOps(db, planId, 0, [{ type: 'add', item: tent }], LEAD);
      await expect(applySiteOps(db, planId, 1, [{ type: 'add', item: tent }], LEAD))
        .rejects.toThrow('an item id is already in use');
    });

    it('keeps a locked item where it is until it is unlocked', async () => {
      const planId = await createPlan(db, s26, PLOT, LEAD);
      const tent = tentOf({ locked: true });
      await applySiteOps(db, planId, 0, [{ type: 'add', item: tent }], LEAD);

      await expect(applySiteOps(db, planId, 1, [{ type: 'update', id: tent.id, patch: { xCm: 900 } }], LEAD))
        .rejects.toThrow('that item is locked');
      await expect(applySiteOps(db, planId, 1, [{ type: 'remove', id: tent.id }], LEAD))
        .rejects.toThrow('that item is locked');
      // Renaming is not moving.
      await applySiteOps(db, planId, 1, [{ type: 'update', id: tent.id, patch: { label: 'אוהל הצוות' } }], LEAD);
      // Unlocking and moving in one patch is allowed.
      await applySiteOps(db, planId, 2, [{ type: 'update', id: tent.id, patch: { locked: false, xCm: 900 } }], LEAD);
      const [row] = await listItems(db, planId);
      expect(row).toMatchObject({ label: 'אוהל הצוות', xCm: 900, locked: false });
    });

    it('links only a build task of this season', async () => {
      const planId = await createPlan(db, s26, PLOT, LEAD);
      const [shift] = await db.insert(tasks).values({ seasonId: s26, kind: 'shift', title: 'משמרת בר' }).returning();
      await expect(applySiteOps(db, planId, 0, [{ type: 'add', item: tentOf({ taskId: shift.id }) }], LEAD))
        .rejects.toThrow('that task is not a build task of this season');
    });

    it('drops a kind default when told to', async () => {
      const planId = await createPlan(db, s26, PLOT, LEAD);
      const size = { widthCm: 350, depthCm: 300, heightCm: 210, insetCm: null };
      await applySiteOps(db, planId, 0, [{ type: 'setKindDefault', kind: 'tent', size }], LEAD);
      await applySiteOps(db, planId, 1, [{ type: 'setKindDefault', kind: 'tent', size: null }], LEAD);
      expect(await kindDefaults(db)).toEqual({});
    });

    it('gives a new net the default inset when it has none, and no other kind one', async () => {
      const planId = await createPlan(db, s26, PLOT, LEAD);
      const net = tentOf({ kind: 'shade', label: 'צל', widthCm: 800, depthCm: 800, insetCm: null });
      const sofa = tentOf({ kind: 'sofa', label: 'ספה', insetCm: 40 });
      await applySiteOps(db, planId, 0, [{ type: 'add', item: net }, { type: 'add', item: sofa }], LEAD);
      const rows = await listItems(db, planId);
      expect(rows.find((row) => row.id === net.id)?.insetCm).toBe(50);
      expect(rows.find((row) => row.id === sofa.id)?.insetCm).toBeNull();
    });

    it('rolls back an earlier op in the batch when a later one is refused server-side', async () => {
      const planId = await createPlan(db, s26, PLOT, LEAD);
      const [shift] = await db.insert(tasks).values({ seasonId: s26, kind: 'shift', title: 'משמרת בר' }).returning();
      const a = tentOf();
      const b = tentOf({ taskId: shift.id });
      await expect(applySiteOps(db, planId, 0, [
        { type: 'add', item: a },
        { type: 'add', item: b },
      ], LEAD)).rejects.toThrow('that task is not a build task of this season');
      expect(await listItems(db, planId)).toEqual([]);
      expect((await planForSeason(db, s26))?.version).toBe(0);
    });

    it('rolls back a move when a later op in the same batch hits a locked item', async () => {
      const planId = await createPlan(db, s26, PLOT, LEAD);
      const x = tentOf();
      const y = tentOf({ locked: true });
      await applySiteOps(db, planId, 0, [{ type: 'add', item: x }, { type: 'add', item: y }], LEAD);
      await expect(applySiteOps(db, planId, 1, [
        { type: 'update', id: x.id, patch: { xCm: 999 } },
        { type: 'remove', id: y.id },
      ], LEAD)).rejects.toThrow('that item is locked');
      const rows = await listItems(db, planId);
      expect(rows.find((row) => row.id === x.id)?.xCm).toBe(x.xCm);
    });

    it('keeps the client’s draw order on add', async () => {
      const planId = await createPlan(db, s26, PLOT, LEAD);
      const tent = tentOf({ sort: 7 });
      await applySiteOps(db, planId, 0, [{ type: 'add', item: tent }], LEAD);
      const [row] = await listItems(db, planId);
      expect(row.sort).toBe(7);
    });

    it('refuses to resize a locked item’s height', async () => {
      const planId = await createPlan(db, s26, PLOT, LEAD);
      const tent = tentOf({ locked: true });
      await applySiteOps(db, planId, 0, [{ type: 'add', item: tent }], LEAD);
      await expect(applySiteOps(db, planId, 1, [{ type: 'update', id: tent.id, patch: { heightCm: 200 } }], LEAD))
        .rejects.toThrow('that item is locked');
    });

    it('answers an empty batch with the current version, unbumped', async () => {
      const planId = await createPlan(db, s26, PLOT, LEAD);
      const result = await applySiteOps(db, planId, 0, [], LEAD);
      expect(result).toEqual({ status: 'saved', version: 0 });
      expect((await planForSeason(db, s26))?.version).toBe(0);
    });

    it('keeps a kind default’s inset only for a shade net', async () => {
      const planId = await createPlan(db, s26, PLOT, LEAD);
      await applySiteOps(db, planId, 0, [
        { type: 'setKindDefault', kind: 'tent', size: { widthCm: 350, depthCm: 300, heightCm: 210, insetCm: 40 } },
      ], LEAD);
      expect((await kindDefaults(db)).tent?.insetCm).toBeNull();
    });

    it('refuses an id already used on another season’s map', async () => {
      const mine = await createPlan(db, s26, PLOT, LEAD);
      const theirs = await createPlan(db, s25, PLOT, LEAD);
      const other = tentOf();
      await seed(theirs, other);
      const clash = tentOf({ id: other.id });
      await expect(applySiteOps(db, mine, 0, [{ type: 'add', item: clash }], LEAD))
        .rejects.toThrow('an item id is already in use');
    });
  });
});
