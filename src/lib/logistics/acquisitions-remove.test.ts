import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { persons, seasons } from '@/db/schema/camp';
import { acquisitionItems, inventoryItems, workItems } from '@/db/schema/logistics';
import {
  acquisitionById, acquisitionCounts, createAcquisition, listAcquisitions, recordArrival,
  removeAcquisition, setAcquisitionStatus, updateAcquisition, type AcquisitionInput,
} from './acquisitions';

const LEAD = 'lead@shliff.camp';

const ALL = {
  view: 'all', q: '', category: null, sort: 'name', dir: 'asc',
  season: '', peek: null, creating: false, arriving: false,
} as const;

describe('taking a row out of the acquisitions list', () => {
  let db: TestDb;
  let seasonId: string;

  const input = (over: Partial<AcquisitionInput> = {}): AcquisitionInput => ({
    seasonId,
    name: 'ברגים לעץ', category: 'build', quantityNeeded: 200,
    source: 'buy_new', estimatedCost: '90', actualCost: null,
    assigneePersonId: null, lenderPersonId: null, budgetLineId: null,
    ...over,
  });

  const lineOf = async (acquisitionId: string) => (
    await db.select().from(workItems).where(eq(workItems.acquisitionItemId, acquisitionId))
  )[0];

  beforeEach(async () => {
    db = await createTestDb();
    const [season] = await db.insert(seasons)
      .values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    seasonId = season.id;
    await db.insert(persons).values({ displayName: 'איתי כהן' });
  });

  it('removes the row, and the list and its totals no longer hold it', async () => {
    const keep = await createAcquisition(db, input({ name: 'מקדחה', estimatedCost: '400', quantityNeeded: 1 }), LEAD);
    const gone = await createAcquisition(db, input(), LEAD);

    await removeAcquisition(db, gone, LEAD);

    expect(await acquisitionById(db, gone)).toBeNull();
    expect((await listAcquisitions(db, seasonId, ALL)).map((row) => row.id)).toEqual([keep]);
    const counts = await acquisitionCounts(db, seasonId, ALL);
    expect(counts.total).toBe(1);
    expect(counts.estimatedAgorot).toBe(40000);
  });

  it('leaves its line on the work plan, cancelled and unlinked, under the title it had', async () => {
    const id = await createAcquisition(db, input(), LEAD);
    const before = await lineOf(id);
    expect(before.status).toBe('open');

    await removeAcquisition(db, id, 'other@shliff.camp');

    const [after] = await db.select().from(workItems).where(eq(workItems.id, before.id));
    expect(after.status).toBe('cancelled');
    expect(after.acquisitionItemId).toBeNull();
    expect(after.title).toBe(before.title);
    expect(after.updatedBy).toBe('other@shliff.camp');
  });

  it('touches no other row and no other line', async () => {
    const other = await createAcquisition(db, input({ name: 'מקדחה' }), LEAD);
    const id = await createAcquisition(db, input(), LEAD);

    await removeAcquisition(db, id, LEAD);

    expect(await acquisitionById(db, other)).not.toBeNull();
    expect((await lineOf(other)).status).toBe('open');
  });

  it('removes a camp-wide row that has no line at all', async () => {
    const id = await createAcquisition(db, input({ seasonId: null }), LEAD, null);
    await removeAcquisition(db, id, LEAD);
    expect(await acquisitionById(db, id)).toBeNull();
  });

  it('refuses a row marked arrived, whether or not it was written into the warehouse', async () => {
    const id = await createAcquisition(db, input(), LEAD);
    await setAcquisitionStatus(db, id, 'arrived', LEAD);

    await expect(removeAcquisition(db, id, LEAD)).rejects.toThrow(/an arrived acquisition cannot be removed/);
    expect(await acquisitionById(db, id)).not.toBeNull();
    // Done because it arrived, and not cancelled by the refused removal.
    expect((await lineOf(id)).status).toBe('done');
  });

  it('refuses a row that became stock, and leaves the stock where it is', async () => {
    const id = await createAcquisition(db, input(), LEAD);
    await recordArrival(db, {
      acquisitionId: id,
      target: { kind: 'new', locationText: 'ארגז גדול #2', condition: 'ready' },
      quantity: 200,
      budgetLineId: null,
    }, LEAD);

    await expect(removeAcquisition(db, id, LEAD)).rejects.toThrow(/an arrived acquisition cannot be removed/);
    expect(await db.select().from(inventoryItems)).toHaveLength(1);
  });

  it('refuses a row with an amount paid, and allows it once the amount is cleared', async () => {
    const id = await createAcquisition(db, input({ actualCost: '85' }), LEAD);

    await expect(removeAcquisition(db, id, LEAD)).rejects.toThrow(/a paid acquisition cannot be removed/);
    expect((await lineOf(id)).status).toBe('open');

    await updateAcquisition(db, id, input({ actualCost: null }), LEAD);
    await removeAcquisition(db, id, LEAD);
    expect(await acquisitionById(db, id)).toBeNull();
  });

  it('treats a paid amount of zero as paid — it was typed, and it says the thing was got', async () => {
    const id = await createAcquisition(db, input({ actualCost: '0' }), LEAD);
    await expect(removeAcquisition(db, id, LEAD)).rejects.toThrow(/a paid acquisition cannot be removed/);
  });

  it('refuses a row that is not there, and removes nothing', async () => {
    await createAcquisition(db, input(), LEAD);
    await expect(removeAcquisition(db, '00000000-0000-0000-0000-000000000000', LEAD))
      .rejects.toThrow(/unknown acquisition/);
    expect(await db.select().from(acquisitionItems)).toHaveLength(1);
  });

  it('refuses the second of two presses, rather than failing silently', async () => {
    const id = await createAcquisition(db, input(), LEAD);
    await removeAcquisition(db, id, LEAD);
    await expect(removeAcquisition(db, id, LEAD)).rejects.toThrow(/unknown acquisition/);
  });
});
