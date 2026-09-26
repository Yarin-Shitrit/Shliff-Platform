import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { inventoryItems } from '@/db/schema/logistics';
import { listBoxes, boxById, createBox, updateBox } from './boxes';

const LEAD = 'lead@shliff.camp';

describe('a box is a named place', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('records who made it, and comes back by id', async () => {
    const id = await createBox(db, { name: 'ארגז כחול #1', locationText: 'מדף עליון', notes: null }, LEAD);
    const box = await boxById(db, id);
    expect(box?.name).toBe('ארגז כחול #1');
    expect(box?.locationText).toBe('מדף עליון');
    expect(box?.updatedBy).toBe(LEAD);
    expect(box?.itemCount).toBe(0);
  });

  it('refuses a nameless box', async () => {
    await expect(createBox(db, { name: '  ', locationText: 'מדף', notes: null }, LEAD))
      .rejects.toThrow(/name/);
  });

  it('refuses a box with no place, because a box with no place locates nothing', async () => {
    await expect(createBox(db, { name: 'ארגז', locationText: '', notes: null }, LEAD))
      .rejects.toThrow(/location/);
  });

  it('trims what it stores, so a name that differs by a space is not a second box', async () => {
    const id = await createBox(db, { name: '  ארגז כחול #1 ', locationText: ' מדף ', notes: '  ' }, LEAD);
    const box = await boxById(db, id);
    expect(box?.name).toBe('ארגז כחול #1');
    expect(box?.locationText).toBe('מדף');
    expect(box?.notes).toBeNull();
  });

  it('returns null for a box that is not there rather than throwing', async () => {
    expect(await boxById(db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('saves every field on edit and refuses to edit a box that is not there', async () => {
    const id = await createBox(db, { name: 'ארגז', locationText: 'מדף', notes: null }, LEAD);
    await updateBox(db, id, { name: 'ארגז כחול #2', locationText: 'מכולה', notes: 'שבור בפינה' }, 'other@shliff.camp');

    const box = await boxById(db, id);
    expect(box?.name).toBe('ארגז כחול #2');
    expect(box?.locationText).toBe('מכולה');
    expect(box?.notes).toBe('שבור בפינה');
    expect(box?.updatedBy).toBe('other@shliff.camp');

    await expect(updateBox(db, '00000000-0000-0000-0000-000000000000', {
      name: 'ארגז', locationText: 'מדף', notes: null,
    }, LEAD)).rejects.toThrow(/unknown inventory box/);
  });
});

describe('what the boxes strip says about each box', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('lists boxes by name with how many rows and how much each holds', async () => {
    const blue = await createBox(db, { name: 'ארגז כחול', locationText: 'מדף', notes: null }, LEAD);
    const red = await createBox(db, { name: 'ארגז אדום', locationText: 'מכולה', notes: null }, LEAD);
    await db.insert(inventoryItems).values([
      { name: 'מצקת', category: 'kitchen', quantity: 3, boxId: blue, condition: 'ready' },
      // Retired still takes up the space, so it counts.
      { name: 'מסור', category: 'build', quantity: 1, boxId: blue, condition: 'retired' },
      { name: 'פטיש', category: 'build', quantity: 2, locationText: 'מדף', condition: 'ready' },
    ]);

    const boxes = await listBoxes(db);
    expect(boxes.map((b) => b.name)).toEqual(['ארגז אדום', 'ארגז כחול']);
    const [empty, full] = boxes;
    expect(empty.id).toBe(red);
    expect(empty.itemCount).toBe(0);
    expect(empty.quantity).toBe(0);
    expect(full.itemCount).toBe(2);
    expect(full.quantity).toBe(4);
    // Numbers, not the driver's strings for a bigint.
    expect(typeof full.itemCount).toBe('number');
    expect(typeof full.quantity).toBe('number');
  });

  it('is empty on a warehouse with no boxes, so the strip draws its invitation', async () => {
    expect(await listBoxes(db)).toEqual([]);
  });
});
