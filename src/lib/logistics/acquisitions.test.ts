import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { persons, seasons } from '@/db/schema/camp';
import { inventoryItems } from '@/db/schema/logistics';
import { itemById } from './warehouse';
import {
  listAcquisitions, acquisitionCounts, acquisitionById,
  createAcquisition, updateAcquisition, setAcquisitionStatus, recordArrival,
} from './acquisitions';

const LEAD = 'lead@shliff.camp';

const ALL = {
  view: 'all', q: '', category: null, sort: 'name', dir: 'asc',
  season: '', peek: null, creating: false, arriving: false,
} as const;

async function seed(db: TestDb) {
  const [season] = await db.insert(seasons)
    .values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
  const [itay] = await db.insert(persons).values({ displayName: 'איתי כהן' }).returning();
  return { seasonId: season.id, itayId: itay.id };
}

describe('what the camp still needs for one year', () => {
  let db: TestDb;
  let seasonId: string;
  let itayId: string;

  beforeEach(async () => {
    db = await createTestDb();
    ({ seasonId, itayId } = await seed(db));

    await createAcquisition(db, {
      seasonId,
      name: 'מקדחה רוטטת', category: 'build', quantityNeeded: 1,
      source: 'buy_new', estimatedCost: '400', actualCost: '380',
      assigneePersonId: itayId, lenderPersonId: null, budgetLineId: null,
    }, LEAD);
    await createAcquisition(db, {
      seasonId,
      name: 'ברגים לעץ', category: 'build', quantityNeeded: 200,
      source: 'buy_new', estimatedCost: '90', actualCost: null,
      assigneePersonId: itayId, lenderPersonId: null, budgetLineId: null,
    }, LEAD);
    await createAcquisition(db, {
      seasonId,
      name: 'מקרר קטן', category: 'kitchen', quantityNeeded: 1,
      source: 'borrow_member', estimatedCost: null, actualCost: null,
      assigneePersonId: null, lenderPersonId: itayId, budgetLineId: null,
    }, LEAD);
  });

  it('is scoped to its season, unlike the warehouse', async () => {
    // The two screens disagree about seasons on purpose: gear outlives a burn,
    // a shopping list does not.
    const [other] = await db.insert(seasons)
      .values({ name: 'ברן 27', year: 2027, flatRate: '1200.00' }).returning();
    await createAcquisition(db, {
      seasonId: other.id,
      name: 'אוהל חדש', category: 'living', quantityNeeded: 1,
      source: 'buy_new', estimatedCost: null, actualCost: null,
      assigneePersonId: null, lenderPersonId: null, budgetLineId: null,
    }, LEAD);

    expect(await listAcquisitions(db, seasonId, ALL)).toHaveLength(3);
    expect(await listAcquisitions(db, other.id, ALL)).toHaveLength(1);
  });

  it('lists a camp-wide row under every season, and says which rows those are', async () => {
    // A generator is needed whichever burn is next. One row with no season,
    // rather than a copy per year that somebody has to remember to make.
    const [other] = await db.insert(seasons)
      .values({ name: 'ברן 27', year: 2027, flatRate: '1200.00' }).returning();
    await createAcquisition(db, {
      seasonId: null,
      name: 'גנרטור', category: 'general', quantityNeeded: 1,
      source: 'buy_new', estimatedCost: '5000', actualCost: null,
      assigneePersonId: null, lenderPersonId: null, budgetLineId: null,
    }, LEAD);

    const here = await listAcquisitions(db, seasonId, ALL);
    const there = await listAcquisitions(db, other.id, ALL);
    expect(here.map((row) => row.name)).toContain('גנרטור');
    expect(there.map((row) => row.name)).toEqual(['גנרטור']);
    expect(here.find((row) => row.name === 'גנרטור')?.seasonId).toBeNull();
    expect(here.find((row) => row.name === 'מקדחה רוטטת')?.seasonId).toBe(seasonId);

    // The tiles count it with the season's own rows, and say how many came along.
    const counts = await acquisitionCounts(db, seasonId, ALL);
    expect(counts.total).toBe(4);
    expect(counts.campWide).toBe(1);
    expect(counts.estimatedAgorot).toBe(40000 + 9000 + 500000);
  });

  it('moves a row between one season and every season on edit', async () => {
    const [row] = await listAcquisitions(db, seasonId, { ...ALL, q: 'ברגים' });
    const input = {
      name: row.name, category: row.category, quantityNeeded: row.quantityNeeded,
      source: row.source, estimatedCost: null, actualCost: null,
      assigneePersonId: null, lenderPersonId: null, budgetLineId: null,
    };

    await updateAcquisition(db, row.id, { ...input, seasonId: null }, LEAD);
    expect((await acquisitionById(db, row.id))?.seasonId).toBeNull();

    await updateAcquisition(db, row.id, { ...input, seasonId }, LEAD);
    expect((await acquisitionById(db, row.id))?.seasonId).toBe(seasonId);
  });

  it('starts every row at "to search", because nothing has happened to it yet', async () => {
    const rows = await listAcquisitions(db, seasonId, ALL);
    expect(rows.every((row) => row.status === 'to_search')).toBe(true);
  });

  it('reads money in agorot, never as a float', async () => {
    const [drill] = await listAcquisitions(db, seasonId, { ...ALL, q: 'מקדחה' });
    expect(drill.estimatedAgorot).toBe(40000);
    expect(drill.actualAgorot).toBe(38000);
  });

  it('keeps "not bought yet" and "cost nothing" apart', async () => {
    // Both would be 0 if they collapsed, and the budget tile would then report
    // an estimate the camp never made.
    const [fridge] = await listAcquisitions(db, seasonId, { ...ALL, q: 'מקרר' });
    expect(fridge.estimatedAgorot).toBeNull();
    expect(fridge.actualAgorot).toBeNull();
  });

  it('names the person responsible, rather than handing the screen an id', async () => {
    const [drill] = await listAcquisitions(db, seasonId, { ...ALL, q: 'מקדחה' });
    expect(drill.assignee?.name).toBe('איתי כהן');
  });

  it('names the lender, which only a borrowed row has', async () => {
    const [fridge] = await listAcquisitions(db, seasonId, { ...ALL, q: 'מקרר' });
    expect(fridge.lender?.name).toBe('איתי כהן');
    expect(fridge.assignee).toBeNull();
  });

  it('narrows to a status tab', async () => {
    const rows = await listAcquisitions(db, seasonId, ALL);
    await setAcquisitionStatus(db, rows[0].id, 'ordered', LEAD);
    expect(await listAcquisitions(db, seasonId, { ...ALL, view: 'ordered' })).toHaveLength(1);
  });

  it('searches by name', async () => {
    expect(await listAcquisitions(db, seasonId, { ...ALL, q: 'ברגים' })).toHaveLength(1);
  });

  it('narrows to a category', async () => {
    expect(await listAcquisitions(db, seasonId, { ...ALL, category: 'kitchen' })).toHaveLength(1);
  });

  it('refuses a nameless row and a quantity below one', async () => {
    await expect(createAcquisition(db, {
      seasonId,
      name: ' ', category: 'general', quantityNeeded: 1,
      source: 'buy_new', estimatedCost: null, actualCost: null,
      assigneePersonId: null, lenderPersonId: null, budgetLineId: null,
    }, LEAD)).rejects.toThrow(/name/);

    await expect(createAcquisition(db, {
      seasonId,
      name: 'משהו', category: 'general', quantityNeeded: 0,
      source: 'buy_new', estimatedCost: null, actualCost: null,
      assigneePersonId: null, lenderPersonId: null, budgetLineId: null,
    }, LEAD)).rejects.toThrow(/quantity/);
  });

  it('refuses a borrowed row with nobody to give it back to', async () => {
    // "Borrowed from a camp member" with no member is a promise nobody can
    // keep: at the end of the burn there is a thing and no name to return it
    // to, which is how camps lose friends.
    await expect(createAcquisition(db, {
      seasonId,
      name: 'גנרטור', category: 'build', quantityNeeded: 1,
      source: 'borrow_member', estimatedCost: null, actualCost: null,
      assigneePersonId: null, lenderPersonId: null, budgetLineId: null,
    }, LEAD)).rejects.toThrow(/lender/);
  });

  it('edits a row and stamps who did it', async () => {
    const [row] = await listAcquisitions(db, seasonId, { ...ALL, q: 'ברגים' });
    await updateAcquisition(db, row.id, {
      seasonId,
      name: 'ברגים לעץ 4×60', category: 'build', quantityNeeded: 300,
      source: 'second_hand', estimatedCost: '120', actualCost: null,
      assigneePersonId: null, lenderPersonId: null, budgetLineId: null,
    }, 'buyer@shliff.camp');

    const after = await acquisitionById(db, row.id);
    expect(after?.name).toBe('ברגים לעץ 4×60');
    expect(after?.quantityNeeded).toBe(300);
    expect(after?.estimatedAgorot).toBe(12000);
    expect(after?.updatedBy).toBe('buyer@shliff.camp');
  });

  it('refuses to edit or advance a row that is not there', async () => {
    const missing = '00000000-0000-0000-0000-000000000000';
    await expect(setAcquisitionStatus(db, missing, 'ordered', LEAD))
      .rejects.toThrow(/unknown acquisition/);
  });
});

describe('the figures the screen puts at the top', () => {
  let db: TestDb;
  let seasonId: string;

  beforeEach(async () => {
    db = await createTestDb();
    ({ seasonId } = await seed(db));
  });

  async function add(over: Record<string, unknown> = {}) {
    return createAcquisition(db, {
      seasonId,
      name: 'פריט', category: 'general', quantityNeeded: 1,
      source: 'buy_new', estimatedCost: null, actualCost: null,
      assigneePersonId: null, lenderPersonId: null, budgetLineId: null,
      ...over,
    } as never, LEAD);
  }

  it('counts each status over the whole season, not over the filter', async () => {
    // A tab count that moves when a filter is applied tells a lead there is
    // nothing to switch to.
    const first = await add({ name: 'אחד' });
    await add({ name: 'שניים' });
    await setAcquisitionStatus(db, first, 'ordered', LEAD);

    const counts = await acquisitionCounts(db, seasonId, { ...ALL, view: 'ordered' });
    expect(counts.byStatus.ordered).toBe(1);
    expect(counts.byStatus.to_search).toBe(1);
    expect(counts.total).toBe(2);
  });

  it('totals the estimate and what was actually spent', async () => {
    await add({ name: 'אחד', estimatedCost: '400', actualCost: '380' });
    await add({ name: 'שניים', estimatedCost: '90' });

    const counts = await acquisitionCounts(db, seasonId, ALL);
    expect(counts.estimatedAgorot).toBe(49000);
    expect(counts.actualAgorot).toBe(38000);
  });

  it('reports what is still to buy from the rows that have not arrived', async () => {
    const bought = await add({ name: 'אחד', estimatedCost: '400', actualCost: '380' });
    await add({ name: 'שניים', estimatedCost: '90' });
    await setAcquisitionStatus(db, bought, 'arrived', LEAD);

    const counts = await acquisitionCounts(db, seasonId, ALL);
    expect(counts.remainingAgorot).toBe(9000);
    expect(counts.remainingRows).toBe(1);
  });

  it('counts the arrivals that were never written into the warehouse', async () => {
    // The banner this feeds is the screen's one open decision: the system
    // knows the thing came, and does not know where it was put.
    const came = await add({ name: 'אחד' });
    await setAcquisitionStatus(db, came, 'arrived', LEAD);

    const counts = await acquisitionCounts(db, seasonId, ALL);
    expect(counts.unregisteredArrivals).toBe(1);
  });

  it('totals only the filtered rows in the footer, so it matches what is above it', async () => {
    await add({ name: 'אחד', category: 'kitchen', estimatedCost: '400' });
    await add({ name: 'שניים', category: 'build', estimatedCost: '90' });

    const counts = await acquisitionCounts(db, seasonId, { ...ALL, category: 'kitchen' });
    expect(counts.shownRows).toBe(1);
    expect(counts.shownEstimatedAgorot).toBe(40000);
  });
});

describe('the arrival decision, which the system never makes on its own', () => {
  let db: TestDb;
  let seasonId: string;
  let acquisitionId: string;

  beforeEach(async () => {
    db = await createTestDb();
    ({ seasonId } = await seed(db));
    acquisitionId = await createAcquisition(db, {
      seasonId,
      name: 'מקדחה רוטטת', category: 'build', quantityNeeded: 1,
      source: 'buy_new', estimatedCost: '400', actualCost: '380',
      assigneePersonId: null, lenderPersonId: null, budgetLineId: null,
    }, LEAD);
  });

  it('creates the warehouse row a lead described, and links the two', async () => {
    const itemId = await recordArrival(db, {
      acquisitionId,
      target: { kind: 'new', locationText: 'ארגז גדול #2', condition: 'ready' },
      quantity: 1,
      budgetLineId: null,
    }, LEAD);

    const item = await itemById(db, itemId);
    expect(item?.name).toBe('מקדחה רוטטת');
    expect(item?.locationText).toBe('ארגז גדול #2');
    expect(item?.quantity).toBe(1);

    const after = await acquisitionById(db, acquisitionId);
    expect(after?.status).toBe('arrived');
    expect(after?.arrivedItemId).toBe(itemId);
  });

  it('carries the category over, because it is the same thing', async () => {
    const itemId = await recordArrival(db, {
      acquisitionId,
      target: { kind: 'new', locationText: 'ארגז', condition: 'needs_testing' },
      quantity: 1,
      budgetLineId: null,
    }, LEAD);
    const item = await itemById(db, itemId);
    expect(item?.category).toBe('build');
    expect(item?.condition).toBe('needs_testing');
  });

  it('adds to an existing row when a lead says it is more of something owned', async () => {
    const [existing] = await db.insert(inventoryItems).values({
      name: 'ברגים לעץ', category: 'build', quantity: 100,
      locationText: 'ארגז קטן', condition: 'ready',
    }).returning();

    const itemId = await recordArrival(db, {
      acquisitionId,
      target: { kind: 'existing', itemId: existing.id },
      quantity: 200,
      budgetLineId: null,
    }, LEAD);

    expect(itemId).toBe(existing.id);
    expect((await itemById(db, existing.id))?.quantity).toBe(300);
  });

  it('refuses an arrival with no location, rather than inventing one', async () => {
    await expect(recordArrival(db, {
      acquisitionId,
      target: { kind: 'new', locationText: '   ', condition: 'ready' },
      quantity: 1,
      budgetLineId: null,
    }, LEAD)).rejects.toThrow(/location/);
  });

  it('refuses an arrival of nothing', async () => {
    await expect(recordArrival(db, {
      acquisitionId,
      target: { kind: 'new', locationText: 'ארגז', condition: 'ready' },
      quantity: 0,
      budgetLineId: null,
    }, LEAD)).rejects.toThrow(/quantity/);
  });

  it('leaves no warehouse row behind when the acquisition is not there', async () => {
    // Without a transaction this is exactly the orphan case: the item is
    // written, the link fails, and the warehouse grows a row nobody ordered.
    const before = await db.select().from(inventoryItems);
    await expect(recordArrival(db, {
      acquisitionId: '00000000-0000-0000-0000-000000000000',
      target: { kind: 'new', locationText: 'ארגז', condition: 'ready' },
      quantity: 1,
      budgetLineId: null,
    }, LEAD)).rejects.toThrow(/unknown acquisition/);

    expect(await db.select().from(inventoryItems)).toHaveLength(before.length);
  });

  it('refuses to register the same arrival twice', async () => {
    // The second registration would add the quantity again and leave the
    // first warehouse row orphaned, with nothing on screen saying which of
    // the two the camp actually owns.
    await recordArrival(db, {
      acquisitionId,
      target: { kind: 'new', locationText: 'ארגז', condition: 'ready' },
      quantity: 1,
      budgetLineId: null,
    }, LEAD);

    await expect(recordArrival(db, {
      acquisitionId,
      target: { kind: 'new', locationText: 'ארגז', condition: 'ready' },
      quantity: 1,
      budgetLineId: null,
    }, LEAD)).rejects.toThrow(/already registered/);
  });

  it('marks a row arrived without registering it, which is the open decision', async () => {
    // Somebody says "it came" from the status control. The system knows that
    // much and does not know where it was put, so it holds the row in a state
    // the screen can surface rather than guessing a location.
    await setAcquisitionStatus(db, acquisitionId, 'arrived', LEAD);

    const row = await acquisitionById(db, acquisitionId);
    expect(row?.status).toBe('arrived');
    expect(row?.arrivedItemId).toBeNull();
  });
});
