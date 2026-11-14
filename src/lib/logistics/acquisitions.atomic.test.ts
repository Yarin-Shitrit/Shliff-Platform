import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { seasons } from '@/db/schema/camp';
import { workItems } from '@/db/schema/logistics';

/*
 * A purchase and its line on the board are saved together or not at all.
 * This file makes the second write fail — `purchaseTitle`, which the line's
 * half calls to rebuild the title, replaced by one that throws on demand —
 * and asks what is left of the row's half that ran before it. Its own file
 * because the mock is module-wide, and `acquisitions.test.ts` needs the
 * real function.
 */
const { title } = vi.hoisted(() => ({ title: { fails: false, calls: 0 } }));
vi.mock('./plan', async (original) => {
  const real = await original<typeof import('./plan')>();
  return {
    ...real,
    purchaseTitle: (...args: Parameters<typeof real.purchaseTitle>) => {
      title.calls += 1;
      if (title.fails) throw new Error('the line’s half failed');
      return real.purchaseTitle(...args);
    },
  };
});

import { createAcquisition, updateAcquisition, setAcquisitionStatus, acquisitionById } from './acquisitions';

const LEAD = 'lead@shliff.camp';
const ROW = {
  name: 'מקרר', category: 'kitchen', quantityNeeded: 1, source: 'buy_new',
  estimatedCost: null, actualCost: null,
  assigneePersonId: null, lenderPersonId: null, budgetLineId: null,
} as const;

let db: TestDb;
let seasonId: string;
let id: string;

beforeEach(async () => {
  db = await createTestDb();
  title.fails = false;
  const [season] = await db.insert(seasons).values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
  seasonId = season.id;
  id = await createAcquisition(db, { ...ROW, seasonId }, LEAD);
  title.calls = 0;
  title.fails = true;
});

async function line() {
  const [item] = await db.select().from(workItems).where(eq(workItems.acquisitionItemId, id));
  return item;
}

describe('a purchase and its line, when the line fails after the row was written', () => {
  it('updateAcquisition writes nothing: the row keeps its name and its count', async () => {
    await expect(updateAcquisition(db, id, { ...ROW, seasonId, name: 'מקרר קטן', quantityNeeded: 2 }, LEAD))
      .rejects.toThrow('the line’s half failed');

    // The line's half was reached, so the row's half had already run.
    expect(title.calls).toBe(1);
    const row = await acquisitionById(db, id);
    expect([row?.name, row?.quantityNeeded]).toEqual(['מקרר', 1]);
    expect((await line()).title).toBe('לקנות מקרר');
  });

  it('setAcquisitionStatus writes nothing: the row is not arrived while its line is still open', async () => {
    await expect(setAcquisitionStatus(db, id, 'arrived', LEAD)).rejects.toThrow('the line’s half failed');

    expect(title.calls).toBe(1);
    expect((await acquisitionById(db, id))?.status).toBe('to_search');
    expect((await line()).status).toBe('open');
  });
});
