import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { createTask, listTasks } from '@/lib/work/tasks';
import { inventoryItems, acquisitionItems, taskMaterials } from '@/db/schema/logistics';

const LEAD = 'lead@shliff.camp';

/**
 * Schema-level tests, deliberately not library tests. Each one holds down a
 * decision from the design that a later refactor could quietly reverse:
 * inventory is camp-wide, acquisitions are not, and nothing about a build task
 * cascades into losing the record of what it needed.
 */
describe('logistics schema', () => {
  let db: TestDb;
  let seasonId: string;

  beforeEach(async () => {
    db = await createTestDb();
    seasonId = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 })).id;
  });

  async function buildTask(title: string): Promise<string> {
    await createTask(db, { seasonId, kind: 'build', title, peopleNeeded: 1 });
    return (await listTasks(db, seasonId)).find((t) => t.title === title)!.taskId;
  }

  /**
   * `createTestDb` replays every `drizzle/*.sql` into pglite. A malformed 0009
   * therefore fails here *and* in roughly 200 other files at once, so this is
   * the cheapest place to find out.
   */
  it('applies migration 0009 cleanly', async () => {
    expect(await db.select().from(inventoryItems)).toEqual([]);
    expect(await db.select().from(acquisitionItems)).toEqual([]);
    expect(await db.select().from(taskMaterials)).toEqual([]);
  });

  it('stores a warehouse item with no season, because gear outlives a burn', async () => {
    const [row] = await db.insert(inventoryItems).values({
      name: 'סיר תעשייתי 50 ליטר',
      category: 'kitchen',
      quantity: 2,
      locationText: 'ארגז כחול #1',
      updatedBy: LEAD,
    }).returning();

    expect(row.quantity).toBe(2);
    expect(row.condition).toBe('ready');
    // Camp-wide is a schema fact here, not a convention a screen remembers.
    expect(Object.keys(row)).not.toContain('seasonId');
  });

  it('retires an item instead of losing it', async () => {
    const [row] = await db.insert(inventoryItems).values({
      name: 'מסור עגול', category: 'build', quantity: 1, condition: 'retired', updatedBy: LEAD,
    }).returning();

    // A broken thing stays visible and marked. An absence would be
    // indistinguishable from "nobody has entered it yet".
    expect(row.condition).toBe('retired');
    expect(await db.select().from(inventoryItems)).toHaveLength(1);
  });

  it('accepts an acquisition that belongs to no season, and stores it as camp-wide', async () => {
    // A generator is needed whichever burn is next. The absence of a season
    // is a fact the row carries (null), not a refusal — `0011` dropped the
    // NOT NULL for exactly this row.
    const [row] = await db.insert(acquisitionItems).values({
      name: 'גנרטור', category: 'general', quantityNeeded: 1, source: 'buy_new',
    }).returning();
    expect(row.seasonId).toBeNull();
  });

  it('records an acquisition against its season with both amounts optional', async () => {
    const [row] = await db.insert(acquisitionItems).values({
      seasonId, name: 'ברגים לעץ', category: 'build', quantityNeeded: 200, source: 'buy_new',
    }).returning();

    expect(row.status).toBe('to_search');
    // Not yet bought and cost nothing are different facts, so actualCost is null.
    expect(row.actualCost).toBeNull();
    expect(row.budgetLineId).toBeNull();
  });

  it('refuses a material pointing at a task that does not exist', async () => {
    await expect(
      db.insert(taskMaterials).values({
        taskId: '00000000-0000-0000-0000-000000000000',
        name: 'ברגים לעץ',
        quantityNeeded: 200,
      }),
    ).rejects.toThrow();
  });

  it('keeps the material when the warehouse item it pointed at is deleted', async () => {
    const taskId = await buildTask('בניית ספסלים');
    const [item] = await db.insert(inventoryItems).values({
      name: 'משטחי עץ', category: 'build', quantity: 8, updatedBy: LEAD,
    }).returning();
    await db.insert(taskMaterials).values({
      taskId, name: 'משטחי עץ', quantityNeeded: 8, inventoryItemId: item.id,
    });

    await db.delete(inventoryItems).where(eq(inventoryItems.id, item.id));

    // The requirement survives losing its stock row: it becomes "needs
    // acquiring", never vanishes along with the thing it was pointing at.
    const [material] = await db.select().from(taskMaterials);
    expect(material).toBeTruthy();
    expect(material.inventoryItemId).toBeNull();
    expect(material.quantityNeeded).toBe(8);
  });

  it('drops a task’s materials when the task itself is deleted', async () => {
    const taskId = await buildTask('הקמת מקלחות');
    await db.insert(taskMaterials).values({ taskId, name: 'צינור גינה', quantityNeeded: 2 });

    await db.delete(taskMaterials).where(eq(taskMaterials.taskId, taskId));
    expect(await db.select().from(taskMaterials)).toHaveLength(0);
  });
});
