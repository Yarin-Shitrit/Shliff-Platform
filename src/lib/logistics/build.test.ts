import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { persons, seasons, tasks } from '@/db/schema/camp';
import { inventoryItems } from '@/db/schema/logistics';
import { createAcquisition, setAcquisitionStatus, recordArrival } from './acquisitions';
import {
  materialState, taskMaterialState, listBuildTasks, listMaterials,
  addMaterial, removeMaterial, buildCounts,
  type MaterialRow,
} from './build';

const LEAD = 'lead@shliff.camp';

/**
 * The derivation is a pure function over what was resolved, so the states can
 * be enumerated without a database. The suites below then check that the
 * resolution itself — which is the part that reaches two tables — agrees.
 */
describe('what state a material is in, which is derived and never stored', () => {
  const ready = { id: 'i1', locationText: 'מדף', condition: 'ready' as const, quantity: 4 };

  it('is in stock when it is on a shelf in working order', () => {
    expect(materialState(ready, null)).toBe('in_stock');
  });

  it('is a blocker when the thing on the shelf is not usable', () => {
    expect(materialState({ ...ready, condition: 'needs_repair' }, null)).toBe('needs_repair');
    expect(materialState({ ...ready, condition: 'needs_testing' }, null)).toBe('needs_repair');
  });

  it('counts a retired item as missing, even though the camp owns one', () => {
    // The row still shows its location — there is a broken one, and knowing
    // that saves a search — but a checklist that reads `במחסן` for a pump out
    // of service is the failure this screen exists to prevent.
    expect(materialState({ ...ready, condition: 'retired' }, null)).toBe('missing');
  });

  it('is obtained once it is ordered, before it reaches a shelf', () => {
    expect(materialState(null, { id: 'a1', status: 'ordered' })).toBe('obtained');
    expect(materialState(null, { id: 'a1', status: 'arrived' })).toBe('obtained');
  });

  it('is still missing while it is only on the shopping list', () => {
    expect(materialState(null, { id: 'a1', status: 'to_search' })).toBe('missing');
    expect(materialState(null, { id: 'a1', status: 'in_review' })).toBe('missing');
  });

  it('is missing when nobody has it and nobody ordered it', () => {
    expect(materialState(null, null)).toBe('missing');
  });

  it('lets the shelf win over the order, because that is the later fact', () => {
    expect(materialState(ready, { id: 'a1', status: 'ordered' })).toBe('in_stock');
  });
});

describe('what a task reports about its materials', () => {
  const material = (state: MaterialRow['state']): MaterialRow => ({
    id: 'm', taskId: 't', name: 'x', quantityNeeded: 1, state,
    inventory: null, acquisition: null,
  });

  it('says nothing has been listed, which is not the same as ready', () => {
    // A task nobody has thought about and a task whose needs are all met read
    // identically if these collapse, and only one of them needs attention.
    expect(taskMaterialState([])).toBe('none');
  });

  it('reports the worst state it holds', () => {
    expect(taskMaterialState([material('in_stock'), material('missing')])).toBe('missing');
    expect(taskMaterialState([material('in_stock'), material('needs_repair')])).toBe('needs_repair');
    expect(taskMaterialState([material('in_stock'), material('obtained')])).toBe('ready');
  });
});

describe('the build screen against a real database', () => {
  let db: TestDb;
  let seasonId: string;
  let taskId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const [season] = await db.insert(seasons)
      .values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    seasonId = season.id;

    const [task] = await db.insert(tasks).values({
      seasonId, kind: 'build', title: 'בניית ספסלים', peopleNeeded: 2,
      dueOn: new Date('2026-07-12T00:00:00Z'),
    }).returning();
    taskId = task.id;
  });

  it('reads only the build tasks, because the other kinds are not logistics', async () => {
    await db.insert(tasks).values({
      seasonId, kind: 'shift', title: 'משמרת בר', peopleNeeded: 2,
    });

    const rows = await listBuildTasks(db, seasonId);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('בניית ספסלים');
  });

  it('carries the same people the tasks board shows, rather than querying them again', async () => {
    // `coverageFor` is the משימות board's own function. Two queries would be
    // two answers to "who is on this", and they would drift.
    const rows = await listBuildTasks(db, seasonId);
    expect(rows[0].peopleNeeded).toBe(2);
    expect(rows[0].accepted).toBe(0);
    expect(rows[0].uncovered).toBe(true);
  });

  it('says a task with no materials has none listed', async () => {
    const rows = await listBuildTasks(db, seasonId);
    expect(rows[0].materialState).toBe('none');
  });

  it('follows a material to the shelf it points at', async () => {
    const [item] = await db.insert(inventoryItems).values({
      name: 'משטחי עץ', category: 'build', quantity: 8,
      locationText: 'מאחורי המכולה', condition: 'ready',
    }).returning();
    await addMaterial(db, {
      taskId, name: 'משטחי עץ', quantityNeeded: 8,
      inventoryItemId: item.id, acquisitionItemId: null,
    });

    const [row] = await listBuildTasks(db, seasonId);
    expect(row.materials[0].state).toBe('in_stock');
    expect(row.materials[0].inventory?.locationText).toBe('מאחורי המכולה');
    expect(row.materialState).toBe('ready');
  });

  it('reads the shelf again on every load, so a change over there shows up here', async () => {
    // This is the whole argument for deriving rather than storing: somebody
    // marks the pump broken on the warehouse screen, and the build checklist
    // stops claiming it is ready — with no write on this side at all.
    const [item] = await db.insert(inventoryItems).values({
      name: 'משאבת מים', category: 'sanitation', quantity: 1,
      locationText: 'משטח 2', condition: 'ready',
    }).returning();
    await addMaterial(db, {
      taskId, name: 'משאבת מים', quantityNeeded: 1,
      inventoryItemId: item.id, acquisitionItemId: null,
    });
    expect((await listBuildTasks(db, seasonId))[0].materials[0].state).toBe('in_stock');

    await db.update(inventoryItems).set({ condition: 'needs_repair' });
    expect((await listBuildTasks(db, seasonId))[0].materials[0].state).toBe('needs_repair');
  });

  it('follows an order through to the shelf it arrived into', async () => {
    // A material linked to an order, whose order has since been registered in
    // the warehouse, is on a shelf. A rule that looked only at the direct
    // link would keep reading `הושג` for something a lead could go and fetch.
    const acquisitionId = await createAcquisition(db, seasonId, {
      name: 'מברגה', category: 'build', quantityNeeded: 1, source: 'buy_new',
      estimatedCost: null, actualCost: null,
      assigneePersonId: null, lenderPersonId: null, budgetLineId: null,
    }, LEAD);
    await addMaterial(db, {
      taskId, name: 'מברגה', quantityNeeded: 1,
      inventoryItemId: null, acquisitionItemId: acquisitionId,
    });

    await setAcquisitionStatus(db, acquisitionId, 'ordered', LEAD);
    expect((await listBuildTasks(db, seasonId))[0].materials[0].state).toBe('obtained');

    await recordArrival(db, {
      acquisitionId,
      target: { kind: 'new', locationText: 'ארגז כלים', condition: 'ready' },
      quantity: 1,
      budgetLineId: null,
    }, LEAD);

    const [row] = await listBuildTasks(db, seasonId);
    expect(row.materials[0].state).toBe('in_stock');
    expect(row.materials[0].inventory?.locationText).toBe('ארגז כלים');
  });

  it('puts what is blocked first, then what is due soonest', async () => {
    const [later] = await db.insert(tasks).values({
      seasonId, kind: 'build', title: 'הקמת מקלחות', peopleNeeded: 1,
      dueOn: new Date('2026-07-15T00:00:00Z'),
    }).returning();
    await addMaterial(db, {
      taskId: later.id, name: 'ברגים', quantityNeeded: 200,
      inventoryItemId: null, acquisitionItemId: null,
    });

    const rows = await listBuildTasks(db, seasonId);
    // The blocked one is due later and still leads: this screen is read to
    // find out what is stuck, not what is next.
    expect(rows[0].title).toBe('הקמת מקלחות');
  });

  it('refuses a material on a task that is not a build task', async () => {
    const [shift] = await db.insert(tasks).values({
      seasonId, kind: 'shift', title: 'משמרת בר', peopleNeeded: 1,
    }).returning();

    await expect(addMaterial(db, {
      taskId: shift.id, name: 'קרח', quantityNeeded: 1,
      inventoryItemId: null, acquisitionItemId: null,
    })).rejects.toThrow(/unknown build task/);
  });

  it('refuses a material that points at both a shelf and an order', async () => {
    // Two answers to one question, which would leave this module picking one
    // — the guessing the product refuses to do.
    const [item] = await db.insert(inventoryItems).values({
      name: 'ברגים', category: 'build', quantity: 10,
      locationText: 'ארגז', condition: 'ready',
    }).returning();
    const acquisitionId = await createAcquisition(db, seasonId, {
      name: 'ברגים', category: 'build', quantityNeeded: 200, source: 'buy_new',
      estimatedCost: null, actualCost: null,
      assigneePersonId: null, lenderPersonId: null, budgetLineId: null,
    }, LEAD);

    await expect(addMaterial(db, {
      taskId, name: 'ברגים', quantityNeeded: 200,
      inventoryItemId: item.id, acquisitionItemId: acquisitionId,
    })).rejects.toThrow(/not at both/);
  });

  it('refuses a nameless material and a quantity below one', async () => {
    await expect(addMaterial(db, {
      taskId, name: ' ', quantityNeeded: 1, inventoryItemId: null, acquisitionItemId: null,
    })).rejects.toThrow(/name/);
    await expect(addMaterial(db, {
      taskId, name: 'ברגים', quantityNeeded: 0, inventoryItemId: null, acquisitionItemId: null,
    })).rejects.toThrow(/quantity/);
  });

  it('removes a requirement without touching what it pointed at', async () => {
    const [item] = await db.insert(inventoryItems).values({
      name: 'משטחי עץ', category: 'build', quantity: 8,
      locationText: 'מכולה', condition: 'ready',
    }).returning();
    const id = await addMaterial(db, {
      taskId, name: 'משטחי עץ', quantityNeeded: 8,
      inventoryItemId: item.id, acquisitionItemId: null,
    });

    await removeMaterial(db, id);
    expect(await listMaterials(db, [taskId])).toHaveLength(0);
    expect(await db.select().from(inventoryItems)).toHaveLength(1);
  });

  it('refuses to remove a material that is not there', async () => {
    await expect(removeMaterial(db, '00000000-0000-0000-0000-000000000000'))
      .rejects.toThrow(/unknown material/);
  });
});

describe('the figures at the top of the build screen', () => {
  let db: TestDb;
  let seasonId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const [season] = await db.insert(seasons)
      .values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    seasonId = season.id;
    await db.insert(persons).values({ displayName: 'איתי כהן' });
  });

  it('counts what is open, what is blocked and why', async () => {
    const [blocked] = await db.insert(tasks).values({
      seasonId, kind: 'build', title: 'בניית ספסלים', peopleNeeded: 1,
      dueOn: new Date('2026-07-12T00:00:00Z'),
    }).returning();
    const [broken] = await db.insert(tasks).values({
      seasonId, kind: 'build', title: 'הקמת מקלחות', peopleNeeded: 1,
      dueOn: new Date('2026-07-15T00:00:00Z'),
    }).returning();
    const [item] = await db.insert(inventoryItems).values({
      name: 'משאבת מים', category: 'sanitation', quantity: 1,
      locationText: 'משטח 2', condition: 'needs_repair',
    }).returning();

    await addMaterial(db, {
      taskId: blocked.id, name: 'ברגים', quantityNeeded: 200,
      inventoryItemId: null, acquisitionItemId: null,
    });
    await addMaterial(db, {
      taskId: broken.id, name: 'משאבת מים', quantityNeeded: 1,
      inventoryItemId: item.id, acquisitionItemId: null,
    });

    const counts = buildCounts(await listBuildTasks(db, seasonId));
    expect(counts.openTasks).toBe(2);
    expect(counts.blockedTasks).toBe(2);
    expect(counts.missingMaterials).toBe(1);
    expect(counts.repairMaterials).toBe(1);
    expect(counts.missingOnAcquisitionList).toBe(0);
    expect(counts.nextDueOn).toEqual(new Date('2026-07-12T00:00:00Z'));
  });

  it('says how many of the missing ones are already on the רכש list', async () => {
    // The difference between "we know about it" and "nobody has started" is
    // the whole point of the tile, and it links to the screen that can act.
    const [task] = await db.insert(tasks).values({
      seasonId, kind: 'build', title: 'בניית ספסלים', peopleNeeded: 1,
    }).returning();
    const acquisitionId = await createAcquisition(db, seasonId, {
      name: 'ברגים', category: 'build', quantityNeeded: 200, source: 'buy_new',
      estimatedCost: null, actualCost: null,
      assigneePersonId: null, lenderPersonId: null, budgetLineId: null,
    }, LEAD);

    await addMaterial(db, {
      taskId: task.id, name: 'ברגים', quantityNeeded: 200,
      inventoryItemId: null, acquisitionItemId: acquisitionId,
    });
    await addMaterial(db, {
      taskId: task.id, name: 'דבק', quantityNeeded: 2,
      inventoryItemId: null, acquisitionItemId: null,
    });

    const counts = buildCounts(await listBuildTasks(db, seasonId));
    expect(counts.missingMaterials).toBe(2);
    expect(counts.missingOnAcquisitionList).toBe(1);
  });
});
