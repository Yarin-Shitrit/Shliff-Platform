import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { persons, seasons } from '@/db/schema/camp';
import { acquisitionItems, inventoryItems, workItems } from '@/db/schema/logistics';
import { itemById } from './warehouse';
import { createTopic, createItem, setItemStatus, planItemById } from './plan';
import {
  listAcquisitions, acquisitionCounts, acquisitionById,
  createAcquisition, updateAcquisition, setAcquisitionStatus, recordArrival,
  adoptPurchaseItems, adoptOutcomes,
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
    // 200 screws at 90 each: the count multiplies the price of one.
    expect(counts.estimatedAgorot).toBe(40000 + 200 * 9000 + 500000);
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

  it('prices one and multiplies by how many — the estimate, never what was paid', async () => {
    // A lead checks the price of one and types the count; the system does the
    // sum. What was paid is the receipt for all of them and is left alone.
    const [screws] = await listAcquisitions(db, seasonId, { ...ALL, q: 'ברגים' });
    await updateAcquisition(db, screws.id, {
      seasonId, name: screws.name, category: screws.category, quantityNeeded: 200,
      source: screws.source, estimatedCost: '0.45', actualCost: '85',
      assigneePersonId: null, lenderPersonId: null, budgetLineId: null,
    }, LEAD);

    const after = await acquisitionById(db, screws.id);
    expect(after?.unitEstimateAgorot).toBe(45);
    expect(after?.estimatedAgorot).toBe(9000);
    expect(after?.actualAgorot).toBe(8500);
  });

  it('sorts by the row estimate, not by the price of one', async () => {
    // 200 screws at 90 outrank one drill at 400: the column shows the
    // product, and a sort that disagreed with its own column would read as
    // broken.
    const rows = await listAcquisitions(db, seasonId, { ...ALL, sort: 'estimate', dir: 'desc' });
    const priced = rows.filter((row) => row.estimatedAgorot !== null).map((row) => row.name);
    expect(priced).toEqual(['ברגים לעץ', 'מקדחה רוטטת']);
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
    expect(after?.unitEstimateAgorot).toBe(12000);
    expect(after?.estimatedAgorot).toBe(300 * 12000);
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

describe('a purchase is a line on the work plan', () => {
  let db: TestDb;
  let seasonId: string;
  let itayId: string;

  beforeEach(async () => {
    db = await createTestDb();
    ({ seasonId, itayId } = await seed(db));
  });

  const BLANK_ROW = {
    category: 'general', quantityNeeded: 1, source: 'buy_new',
    estimatedCost: null, actualCost: null,
    assigneePersonId: null, lenderPersonId: null, budgetLineId: null,
  } as const;

  async function linkedItem(acquisitionId: string) {
    const [row] = await db.select().from(workItems).where(eq(workItems.acquisitionItemId, acquisitionId));
    return row ?? null;
  }

  it('entering a row makes an open ״לקנות״ item on that season’s board, linked both ways', async () => {
    const kitchen = await createTopic(db, seasonId, { name: 'מטבח', notes: null }, LEAD);
    const id = await createAcquisition(db, {
      ...BLANK_ROW, seasonId, name: ' מקרר ', assigneePersonId: itayId,
    }, LEAD, { seasonId, topicId: kitchen });

    const item = await linkedItem(id);
    expect(item?.title).toBe('לקנות מקרר');
    expect(item?.seasonId).toBe(seasonId);
    expect(item?.topicId).toBe(kitchen);
    expect(item?.assigneePersonId).toBe(itayId);
    expect(item?.status).toBe('open');
    expect(item?.updatedBy).toBe(LEAD);
    expect((await acquisitionById(db, id))?.workItem).toEqual({ id: item?.id, seasonId });
    expect((await planItemById(db, item!.id))?.purchase).toEqual({ id, status: 'to_search' });
  });

  it('writes the quantity and the way of getting it into the title', async () => {
    const chairs = await createAcquisition(db, { ...BLANK_ROW, seasonId, name: 'כיסא', quantityNeeded: 12 }, LEAD);
    const fridge = await createAcquisition(db, { ...BLANK_ROW, seasonId, name: 'מקרר', source: 'second_hand' }, LEAD);
    const tent = await createAcquisition(db, {
      ...BLANK_ROW, seasonId, name: 'אוהל', source: 'borrow_member', lenderPersonId: itayId,
    }, LEAD);
    expect((await linkedItem(chairs))?.title).toBe('לקנות כיסא (12)');
    expect((await linkedItem(fridge))?.title).toBe('להשיג מקרר');
    expect((await linkedItem(tent))?.title).toBe('להשאיל אוהל');
  });

  it('puts a camp-wide row on the board the lead was looking at, and on none when no board was named', async () => {
    const generator = await createAcquisition(db, { ...BLANK_ROW, seasonId: null, name: 'גנרטור' }, LEAD, { seasonId, topicId: null });
    expect((await linkedItem(generator))?.seasonId).toBe(seasonId);
    const pump = await createAcquisition(db, { ...BLANK_ROW, seasonId: null, name: 'משאבה' }, LEAD);
    expect(await linkedItem(pump)).toBeNull();
    expect((await acquisitionById(db, pump))?.workItem).toBeNull();
  });

  it('refuses a board placement it cannot resolve, and writes no row', async () => {
    await expect(createAcquisition(db, { ...BLANK_ROW, seasonId, name: 'מקרר' }, LEAD, { seasonId, topicId: 'nope' }))
      .rejects.toThrow(/unknown topic/);
    expect(await listAcquisitions(db, seasonId, ALL)).toEqual([]);
  });

  it('renames the item and moves its person when the row is edited', async () => {
    const id = await createAcquisition(db, { ...BLANK_ROW, seasonId, name: 'מקרר' }, LEAD);
    await updateAcquisition(db, id, {
      ...BLANK_ROW, seasonId, name: 'מקרר קטן', quantityNeeded: 2, assigneePersonId: itayId,
    }, 'buyer@shliff.camp');
    const item = await linkedItem(id);
    expect(item?.title).toBe('לקנות מקרר קטן (2)');
    expect(item?.assigneePersonId).toBe(itayId);
    expect(item?.updatedBy).toBe('buyer@shliff.camp');
  });

  it('marks the item done when the row arrives, and open again when it is moved back', async () => {
    const id = await createAcquisition(db, { ...BLANK_ROW, seasonId, name: 'מקרר' }, LEAD);
    await setAcquisitionStatus(db, id, 'arrived', LEAD);
    expect((await linkedItem(id))?.status).toBe('done');
    await setAcquisitionStatus(db, id, 'ordered', LEAD);
    expect((await linkedItem(id))?.status).toBe('open');
  });

  it('marks the item done when the arrival is registered in the warehouse', async () => {
    const id = await createAcquisition(db, { ...BLANK_ROW, seasonId, name: 'מקרר' }, LEAD);
    await recordArrival(db, {
      acquisitionId: id,
      target: { kind: 'new', locationText: 'מכולה', condition: 'ready' },
      quantity: 1, budgetLineId: null,
    }, LEAD);
    expect((await linkedItem(id))?.status).toBe('done');
  });

  it('leaves a cancelled item cancelled: the board’s decision is not undone by a delivery', async () => {
    const id = await createAcquisition(db, { ...BLANK_ROW, seasonId, name: 'מקרר' }, LEAD);
    const item = await linkedItem(id);
    await setItemStatus(db, item!.id, 'cancelled', LEAD);
    await setAcquisitionStatus(db, id, 'arrived', LEAD);
    expect((await linkedItem(id))?.status).toBe('cancelled');
  });

  describe('adopting the ״לקנות״ items already on the board', () => {
    const BLANK_ITEM = {
      notes: null, topicId: null, parentId: null, startsOn: null, endsOn: null, assigneePersonId: null,
    };

    it('turns the chosen items into rows, each linked, named without the verb, with its person', async () => {
      const container = await createItem(db, seasonId, { ...BLANK_ITEM, title: 'לקנות מכולה', assigneePersonId: itayId }, LEAD);
      const boards = await createItem(db, seasonId, { ...BLANK_ITEM, title: 'קניית קרשים' }, LEAD);
      const bare = await createItem(db, seasonId, { ...BLANK_ITEM, title: 'גז למטבח' }, LEAD);

      expect(await adoptPurchaseItems(db, seasonId, [container, boards, bare], LEAD)).toBe(3);

      const rows = await listAcquisitions(db, seasonId, ALL);
      expect(rows.map((row) => row.name).sort()).toEqual(['גז למטבח', 'מכולה', 'קרשים'].sort());
      const containerRow = rows.find((row) => row.name === 'מכולה')!;
      expect(containerRow.assignee?.id).toBe(itayId);
      expect(containerRow.source).toBe('buy_new');
      expect(containerRow.status).toBe('to_search');
      expect(containerRow.workItem?.id).toBe(container);
      expect((await planItemById(db, container))?.title).toBe('לקנות מכולה');
      expect((await planItemById(db, boards))?.title).toBe('לקנות קרשים');
      expect((await planItemById(db, bare))?.title).toBe('לקנות גז למטבח');
      expect((await planItemById(db, bare))?.purchase?.status).toBe('to_search');
    });

    /** A row with no line on the board, as every row written before the link was. */
    async function bareRow(name: string, over: Partial<typeof acquisitionItems.$inferInsert> = {}) {
      const [row] = await db.insert(acquisitionItems).values({
        seasonId, name, category: 'kitchen', quantityNeeded: 3, source: 'second_hand', updatedBy: LEAD, ...over,
      }).returning();
      return row.id;
    }
    const named = async (name: string) =>
      (await listAcquisitions(db, seasonId, ALL)).filter((row) => row.name === name);

    it('links an item to the row of that name already in the list, and writes no second row', async () => {
      const rowId = await bareRow('מכולה');
      const before = (await listAcquisitions(db, seasonId, ALL)).length;
      const item = await createItem(db, seasonId, { ...BLANK_ITEM, title: 'לקנות מכולה', assigneePersonId: itayId }, LEAD);

      const preview = (await adoptOutcomes(db, seasonId, [{ id: item, title: 'לקנות מכולה' }])).get(item);
      expect(preview?.existing).toEqual({ id: rowId, name: 'מכולה', assignee: null });
      expect(preview?.boardTitle).toBe('להשיג מכולה (3)');

      expect(await adoptPurchaseItems(db, seasonId, [item], LEAD)).toBe(1);

      expect(await listAcquisitions(db, seasonId, ALL)).toHaveLength(before);
      const [row] = await named('מכולה');
      expect(row.id).toBe(rowId);
      expect(row.workItem?.id).toBe(item);
      // The row is the list's: its way of getting it and its count stand, and name the board's line.
      expect(row.source).toBe('second_hand');
      expect((await planItemById(db, item))?.title).toBe('להשיג מכולה (3)');
      // It had nobody; the item's person fills the blank.
      expect(row.assignee?.id).toBe(itayId);
    });

    it('tells the preview whose name the row carries, since that is the one that stays on both', async () => {
      const [noa] = await db.insert(persons).values({ displayName: 'נועה לוי' }).returning();
      const rowId = await bareRow('מכולה', { assigneePersonId: noa.id });
      const item = await createItem(db, seasonId, { ...BLANK_ITEM, title: 'לקנות מכולה', assigneePersonId: itayId }, LEAD);

      const preview = (await adoptOutcomes(db, seasonId, [{ id: item, title: 'לקנות מכולה' }])).get(item);
      expect(preview?.existing).toEqual({ id: rowId, name: 'מכולה', assignee: { id: noa.id, name: 'נועה לוי' } });

      await adoptPurchaseItems(db, seasonId, [item], LEAD);
      // The list is the authority: the row keeps its person, and the board's line follows it.
      expect((await named('מכולה'))[0].assignee?.id).toBe(noa.id);
      expect((await planItemById(db, item))?.assignee?.personId).toBe(noa.id);
    });

    it('matches a name whatever quote mark it was typed with, and leaves both spellings as typed', async () => {
      const rowId = await bareRow("צ'ילר");
      const item = await createItem(db, seasonId, { ...BLANK_ITEM, title: 'לקנות צ\u05F3ילר' }, LEAD);
      await adoptPurchaseItems(db, seasonId, [item], LEAD);
      expect((await named("צ'ילר")).map((row) => row.id)).toEqual([rowId]);
      expect(await named('צ\u05F3ילר')).toHaveLength(0);
    });

    it('stores a new row’s name as it was typed, geresh and all', async () => {
      const item = await createItem(db, seasonId, { ...BLANK_ITEM, title: 'לקנות ראנצ\u05F3ו' }, LEAD);
      await adoptPurchaseItems(db, seasonId, [item], LEAD);
      expect(await named('ראנצ\u05F3ו')).toHaveLength(1);
      expect((await planItemById(db, item))?.title).toBe('לקנות ראנצ\u05F3ו');
    });

    it('reads ״להשיג״ as second hand, and leaves the board’s title as the lead wrote it', async () => {
      const item = await createItem(db, seasonId, { ...BLANK_ITEM, title: 'להשיג מקרר' }, LEAD);
      await adoptPurchaseItems(db, seasonId, [item], LEAD);
      const [row] = await named('מקרר');
      expect(row.source).toBe('second_hand');
      expect((await planItemById(db, item))?.title).toBe('להשיג מקרר');
      expect(await named('להשיג מקרר')).toHaveLength(0);
    });

    it('refuses a borrowed thing with no lender, and two rows of one name, writing nothing', async () => {
      const before = (await listAcquisitions(db, seasonId, ALL)).length;
      const tent = await createItem(db, seasonId, { ...BLANK_ITEM, title: 'להשאיל אוהל' }, LEAD);
      expect((await adoptOutcomes(db, seasonId, [{ id: tent, title: 'להשאיל אוהל' }])).get(tent)?.refusal).toBe('needs_lender');
      await expect(adoptPurchaseItems(db, seasonId, [tent], LEAD)).rejects.toThrow(/needs a lender/);

      await bareRow('גנרטור');
      await bareRow('גנרטור');
      const generator = await createItem(db, seasonId, { ...BLANK_ITEM, title: 'לקנות גנרטור' }, LEAD);
      expect((await adoptOutcomes(db, seasonId, [{ id: generator, title: 'לקנות גנרטור' }])).get(generator)?.refusal).toBe('ambiguous');
      await expect(adoptPurchaseItems(db, seasonId, [generator], LEAD)).rejects.toThrow(/several acquisitions share the name/);

      expect(await listAcquisitions(db, seasonId, ALL)).toHaveLength(before + 2);
      expect((await planItemById(db, tent))?.purchase).toBeNull();
      expect((await planItemById(db, generator))?.purchase).toBeNull();
    });

    it('does not match a row that already has a line, or one that has arrived', async () => {
      // "מקדחה רוטטת" was made by createAcquisition in beforeEach, so it has its line.
      const drill = await createItem(db, seasonId, { ...BLANK_ITEM, title: 'לקנות מקדחה רוטטת' }, LEAD);
      await bareRow('סולם', { status: 'arrived' });
      const ladder = await createItem(db, seasonId, { ...BLANK_ITEM, title: 'לקנות סולם' }, LEAD);
      const preview = await adoptOutcomes(db, seasonId, [
        { id: drill, title: 'לקנות מקדחה רוטטת' }, { id: ladder, title: 'לקנות סולם' },
      ]);
      expect(preview.get(drill)?.existing).toBeNull();
      expect(preview.get(ladder)?.existing).toBeNull();
    });

    it('refuses nothing chosen, an item already in the list, one that is done, and one of another season', async () => {
      const [other] = await db.insert(seasons).values({ name: 'ברן 27', year: 2027, flatRate: '1200.00' }).returning();
      const linked = await createItem(db, seasonId, { ...BLANK_ITEM, title: 'לקנות מכולה' }, LEAD);
      await adoptPurchaseItems(db, seasonId, [linked], LEAD);
      const done = await createItem(db, seasonId, { ...BLANK_ITEM, title: 'לקנות גז' }, LEAD);
      await setItemStatus(db, done, 'done', LEAD);
      const foreign = await createItem(db, other.id, { ...BLANK_ITEM, title: 'לקנות אוהל' }, LEAD);

      await expect(adoptPurchaseItems(db, seasonId, [], LEAD)).rejects.toThrow(/nothing was chosen/);
      await expect(adoptPurchaseItems(db, seasonId, [linked], LEAD)).rejects.toThrow(/already in the acquisitions list/);
      await expect(adoptPurchaseItems(db, seasonId, [done], LEAD)).rejects.toThrow(/not open/);
      await expect(adoptPurchaseItems(db, seasonId, [foreign], LEAD)).rejects.toThrow(/unknown work item/);
      // One refusal, nothing written: the list holds the one row from before.
      const fine = await createItem(db, seasonId, { ...BLANK_ITEM, title: 'לקנות קרשים' }, LEAD);
      await expect(adoptPurchaseItems(db, seasonId, [fine, done], LEAD)).rejects.toThrow(/not open/);
      expect(await listAcquisitions(db, seasonId, ALL)).toHaveLength(1);
      expect((await planItemById(db, fine))?.purchase).toBeNull();
    });
  });
});
