import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { inventoryItems } from '@/db/schema/logistics';
import {
  listWarehouse, warehouseCounts, itemById, setCondition,
  createItem, updateItem, addToItem, frequentLocations,
} from './warehouse';

const LEAD = 'lead@shliff.camp';

describe('warehouse', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
    await db.insert(inventoryItems).values([
      { name: 'סיר תעשייתי', category: 'kitchen', quantity: 2, locationText: 'ארגז כחול #1', condition: 'ready', updatedBy: LEAD },
      { name: 'גזייה', category: 'kitchen', quantity: 1, locationText: 'מדף עליון', condition: 'needs_testing', updatedBy: LEAD },
      { name: 'משאבת מים', category: 'sanitation', quantity: 2, locationText: 'משטח 2', condition: 'needs_repair', updatedBy: LEAD },
      { name: 'מסור עגול', category: 'build', quantity: 1, locationText: 'ארגז גדול #2', condition: 'retired', updatedBy: LEAD },
      { name: 'מאריך חשמל', category: 'build', quantity: 4, locationText: 'ארגז גדול #1', condition: 'ready', updatedBy: LEAD },
    ]);
  });

  it('lists everything the camp owns, with no season involved', async () => {
    const rows = await listWarehouse(db, { view: 'all', q: '', category: null, sort: 'name', dir: 'asc', peek: null, creating: false });
    expect(rows).toHaveLength(5);
  });

  it('keeps a retired item in the list rather than hiding it', async () => {
    // Hiding it would make "we own a broken saw" indistinguishable from "we
    // own no saw", which is the ambiguity the retired state exists to remove.
    const rows = await listWarehouse(db, { view: 'all', q: '', category: null, sort: 'name', dir: 'asc', peek: null, creating: false });
    expect(rows.map((r) => r.name)).toContain('מסור עגול');
  });

  it('narrows to one category', async () => {
    const rows = await listWarehouse(db, { view: 'all', q: '', category: 'kitchen', sort: 'name', dir: 'asc', peek: null, creating: false });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.category === 'kitchen')).toBe(true);
  });

  it('gathers everything that needs doing into one view', async () => {
    const rows = await listWarehouse(db, { view: 'attention', q: '', category: null, sort: 'name', dir: 'asc', peek: null, creating: false });
    expect(rows.map((r) => r.name).sort()).toEqual(['גזייה', 'משאבת מים'].sort());
  });

  it('searches the location as well as the name', async () => {
    // The screen's placeholder promises both, and "what is in the blue box"
    // is a question people actually ask while standing in the unit.
    const byName = await listWarehouse(db, { view: 'all', q: 'סיר', category: null, sort: 'name', dir: 'asc', peek: null, creating: false });
    expect(byName).toHaveLength(1);

    const byPlace = await listWarehouse(db, { view: 'all', q: 'ארגז גדול', category: null, sort: 'name', dir: 'asc', peek: null, creating: false });
    expect(byPlace.map((r) => r.name).sort()).toEqual(['מאריך חשמל', 'מסור עגול'].sort());
  });

  it('sorts by condition worst-first, because that is the actionable end', async () => {
    const rows = await listWarehouse(db, { view: 'all', q: '', category: null, sort: 'condition', dir: 'asc', peek: null, creating: false });
    expect(rows[0].condition).toBe('needs_repair');
    expect(rows[1].condition).toBe('needs_testing');
    expect(rows[rows.length - 1].condition).toBe('retired');
  });

  it('counts each category over everything, not over the filtered page', async () => {
    // The chip counts have to stay put while a filter is applied, or the
    // control tells you there is nothing to switch to.
    const counts = await warehouseCounts(db, { view: 'all', q: '', category: 'kitchen', sort: 'name', dir: 'asc', peek: null, creating: false });
    expect(counts.byCategory.kitchen).toBe(2);
    expect(counts.byCategory.build).toBe(2);
    expect(counts.byCategory.living).toBe(0);
  });

  it('totals the quantity of the filtered set, so the footer matches the rows', async () => {
    const counts = await warehouseCounts(db, { view: 'all', q: '', category: 'build', sort: 'name', dir: 'asc', peek: null, creating: false });
    expect(counts.shownQuantity).toBe(5); // 1 + 4
    expect(counts.shownRows).toBe(2);
  });

  it('reports what needs attention, for the tiles that link here', async () => {
    const counts = await warehouseCounts(db, { view: 'all', q: '', category: null, sort: 'name', dir: 'asc', peek: null, creating: false });
    expect(counts.needsTesting).toBe(1);
    expect(counts.needsRepair).toBe(1);
  });

  it('changes a condition and records who did it', async () => {
    const [row] = await db.select().from(inventoryItems).limit(1);
    await setCondition(db, row.id, 'needs_repair', LEAD);

    const after = await itemById(db, row.id);
    expect(after?.condition).toBe('needs_repair');
    expect(after?.updatedBy).toBe(LEAD);
  });

  it('returns null for an item that does not exist rather than throwing', async () => {
    expect(await itemById(db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

const ALL = { view: 'all', q: '', category: null, sort: 'name', dir: 'asc', peek: null, creating: false } as const;

describe('adding to the warehouse by hand, because there is no workbook to import', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('records who entered it, because a quantity here is a judgement', async () => {
    const id = await createItem(db, {
      name: 'אוהל צל', category: 'living', quantity: 3,
      locationText: 'מכולה', condition: 'ready', notes: null,
    }, LEAD);

    const row = await itemById(db, id);
    expect(row?.name).toBe('אוהל צל');
    expect(row?.quantity).toBe(3);
    expect(row?.updatedBy).toBe(LEAD);
  });

  it('refuses a nameless item rather than storing a row nobody can identify', async () => {
    await expect(createItem(db, {
      name: '   ', category: 'general', quantity: 1,
      locationText: 'מדף', condition: 'ready', notes: null,
    }, LEAD)).rejects.toThrow(/name/);
  });

  it('refuses an item with no location', async () => {
    // The arrival drawer states the reason on screen: without a location the
    // thing cannot be found next year, and an inventory nobody can search is
    // worth less than no inventory at all.
    await expect(createItem(db, {
      name: 'מקדחה', category: 'build', quantity: 1,
      locationText: '  ', condition: 'ready', notes: null,
    }, LEAD)).rejects.toThrow(/location/);
  });

  it('refuses a negative quantity instead of storing one', async () => {
    await expect(createItem(db, {
      name: 'מקדחה', category: 'build', quantity: -2,
      locationText: 'ארגז', condition: 'ready', notes: null,
    }, LEAD)).rejects.toThrow(/quantity/);
  });

  it('allows zero, which is a fact and not a blank', async () => {
    // "We have none of these right now" is different from "nobody has counted
    // them", and the warehouse has to be able to say the first one.
    const id = await createItem(db, {
      name: 'בלוני גז', category: 'kitchen', quantity: 0,
      locationText: 'מכולה', condition: 'ready', notes: null,
    }, LEAD);
    expect((await itemById(db, id))?.quantity).toBe(0);
  });

  it('refuses a category the labels cannot name', async () => {
    // A category with no Hebrew label would render its raw enum value on a
    // Hebrew screen, which is the failure `labels.ts` exists to prevent.
    await expect(createItem(db, {
      name: 'משהו', category: 'furniture' as never, quantity: 1,
      locationText: 'מדף', condition: 'ready', notes: null,
    }, LEAD)).rejects.toThrow(/category/);
  });
});

describe('editing an item that is already in the warehouse', () => {
  let db: TestDb;
  let id: string;

  beforeEach(async () => {
    db = await createTestDb();
    id = await createItem(db, {
      name: 'סיר תעשייתי', category: 'kitchen', quantity: 2,
      locationText: 'ארגז כחול #1', condition: 'ready', notes: null,
    }, LEAD);
  });

  it('saves every field the drawer offers, and stamps the editor', async () => {
    await updateItem(db, id, {
      name: 'סיר תעשייתי 50 ליטר', category: 'kitchen', quantity: 1,
      locationText: 'מדף עליון', condition: 'needs_testing', notes: 'הידית רופפת',
    }, 'someone@shliff.camp');

    const row = await itemById(db, id);
    expect(row?.name).toBe('סיר תעשייתי 50 ליטר');
    expect(row?.quantity).toBe(1);
    expect(row?.locationText).toBe('מדף עליון');
    expect(row?.condition).toBe('needs_testing');
    expect(row?.notes).toBe('הידית רופפת');
    expect(row?.updatedBy).toBe('someone@shliff.camp');
  });

  it('applies the same refusals as creating one', async () => {
    await expect(updateItem(db, id, {
      name: '', category: 'kitchen', quantity: 1,
      locationText: 'מדף', condition: 'ready', notes: null,
    }, LEAD)).rejects.toThrow(/name/);
  });

  it('refuses to edit an item that is not there, rather than silently doing nothing', async () => {
    // An update that matches no row succeeds at the driver level and changes
    // nothing, so the screen would report a save that never happened.
    await expect(updateItem(db, '00000000-0000-0000-0000-000000000000', {
      name: 'משהו', category: 'general', quantity: 1,
      locationText: 'מדף', condition: 'ready', notes: null,
    }, LEAD)).rejects.toThrow(/unknown inventory item/);
  });

  it('adds an arriving quantity to what is already on the shelf', async () => {
    // What the acquisitions screen does when a lead says the thing that
    // arrived is more of something the camp already owns.
    await addToItem(db, id, 3, 'buyer@shliff.camp');
    const row = await itemById(db, id);
    expect(row?.quantity).toBe(5);
    expect(row?.updatedBy).toBe('buyer@shliff.camp');
  });

  it('refuses to add nothing, or less than nothing', async () => {
    await expect(addToItem(db, id, 0, LEAD)).rejects.toThrow(/quantity/);
    await expect(addToItem(db, id, -1, LEAD)).rejects.toThrow(/quantity/);
  });
});

describe('what the header line says about the warehouse as a whole', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('reports the newest edit, so the page can say when it was last touched', async () => {
    expect((await warehouseCounts(db, ALL)).lastUpdatedAt).toBeNull();

    await createItem(db, {
      name: 'אוהל צל', category: 'living', quantity: 1,
      locationText: 'מכולה', condition: 'ready', notes: null,
    }, LEAD);

    const counts = await warehouseCounts(db, ALL);
    expect(counts.lastUpdatedAt).toBeInstanceOf(Date);
  });

  it('counts the retired rows, because the view that shows them needs a number', async () => {
    await createItem(db, {
      name: 'מסור עגול', category: 'build', quantity: 1,
      locationText: 'ארגז', condition: 'retired', notes: null,
    }, LEAD);
    expect((await warehouseCounts(db, ALL)).retired).toBe(1);
  });
});

describe('frequentLocations — the chips under the location box', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
    await db.insert(inventoryItems).values([
      { name: 'א', category: 'kitchen', quantity: 1, locationText: 'ארגז כחול #1', condition: 'ready', updatedBy: LEAD },
      { name: 'ב', category: 'kitchen', quantity: 1, locationText: 'ארגז כחול #1', condition: 'retired', updatedBy: LEAD },
      { name: 'ג', category: 'build', quantity: 1, locationText: 'מדף עליון', condition: 'ready', updatedBy: LEAD },
      { name: 'ד', category: 'build', quantity: 1, locationText: 'ארגז גדול #2', condition: 'ready', updatedBy: LEAD },
      { name: 'ה', category: 'build', quantity: 1, locationText: 'ארגז גדול #2', condition: 'ready', updatedBy: LEAD },
      { name: 'ו', category: 'build', quantity: 1, locationText: 'ארגז גדול #2', condition: 'ready', updatedBy: LEAD },
      { name: 'ז', category: 'general', quantity: 1, locationText: null, condition: 'ready', updatedBy: LEAD },
    ]);
  });

  it('lists each stored location once, most-used first, ties by name', async () => {
    expect(await frequentLocations(db)).toEqual(['ארגז גדול #2', 'ארגז כחול #1', 'מדף עליון']);
  });

  it('counts a retired item’s box — the box is still real — and skips a missing location', async () => {
    const locations = await frequentLocations(db);
    expect(locations).toContain('ארגז כחול #1');
    expect(locations).not.toContain(null);
    expect(locations).toHaveLength(3);
  });

  it('stops at the limit it was given', async () => {
    expect(await frequentLocations(db, 2)).toEqual(['ארגז גדול #2', 'ארגז כחול #1']);
  });

  it('is empty on an empty warehouse, so the drawer draws no chip row', async () => {
    const fresh = await createTestDb();
    expect(await frequentLocations(fresh)).toEqual([]);
  });
});
