import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { inventoryItems } from '@/db/schema/logistics';
import {
  listWarehouse, warehouseCounts, itemById, setCondition,
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
    const rows = await listWarehouse(db, { view: 'all', q: '', category: null, sort: 'name', dir: 'asc', peek: null });
    expect(rows).toHaveLength(5);
  });

  it('keeps a retired item in the list rather than hiding it', async () => {
    // Hiding it would make "we own a broken saw" indistinguishable from "we
    // own no saw", which is the ambiguity the retired state exists to remove.
    const rows = await listWarehouse(db, { view: 'all', q: '', category: null, sort: 'name', dir: 'asc', peek: null });
    expect(rows.map((r) => r.name)).toContain('מסור עגול');
  });

  it('narrows to one category', async () => {
    const rows = await listWarehouse(db, { view: 'all', q: '', category: 'kitchen', sort: 'name', dir: 'asc', peek: null });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.category === 'kitchen')).toBe(true);
  });

  it('gathers everything that needs doing into one view', async () => {
    const rows = await listWarehouse(db, { view: 'attention', q: '', category: null, sort: 'name', dir: 'asc', peek: null });
    expect(rows.map((r) => r.name).sort()).toEqual(['גזייה', 'משאבת מים'].sort());
  });

  it('searches the location as well as the name', async () => {
    // The screen's placeholder promises both, and "what is in the blue box"
    // is a question people actually ask while standing in the unit.
    const byName = await listWarehouse(db, { view: 'all', q: 'סיר', category: null, sort: 'name', dir: 'asc', peek: null });
    expect(byName).toHaveLength(1);

    const byPlace = await listWarehouse(db, { view: 'all', q: 'ארגז גדול', category: null, sort: 'name', dir: 'asc', peek: null });
    expect(byPlace.map((r) => r.name).sort()).toEqual(['מאריך חשמל', 'מסור עגול'].sort());
  });

  it('sorts by condition worst-first, because that is the actionable end', async () => {
    const rows = await listWarehouse(db, { view: 'all', q: '', category: null, sort: 'condition', dir: 'asc', peek: null });
    expect(rows[0].condition).toBe('needs_repair');
    expect(rows[1].condition).toBe('needs_testing');
    expect(rows[rows.length - 1].condition).toBe('retired');
  });

  it('counts each category over everything, not over the filtered page', async () => {
    // The chip counts have to stay put while a filter is applied, or the
    // control tells you there is nothing to switch to.
    const counts = await warehouseCounts(db, { view: 'all', q: '', category: 'kitchen', sort: 'name', dir: 'asc', peek: null });
    expect(counts.byCategory.kitchen).toBe(2);
    expect(counts.byCategory.build).toBe(2);
    expect(counts.byCategory.living).toBe(0);
  });

  it('totals the quantity of the filtered set, so the footer matches the rows', async () => {
    const counts = await warehouseCounts(db, { view: 'all', q: '', category: 'build', sort: 'name', dir: 'asc', peek: null });
    expect(counts.shownQuantity).toBe(5); // 1 + 4
    expect(counts.shownRows).toBe(2);
  });

  it('reports what needs attention, for the tiles that link here', async () => {
    const counts = await warehouseCounts(db, { view: 'all', q: '', category: null, sort: 'name', dir: 'asc', peek: null });
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
