import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { seasons } from './camp';
import { siteItems, siteKindDefaults, sitePlans } from './site';

describe('site schema, migration 0012', () => {
  let db: TestDb;
  let planId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const [season] = await db.insert(seasons).values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    const [plan] = await db.insert(sitePlans).values({ seasonId: season.id, widthCm: 2600, depthCm: 2400 }).returning();
    planId = plan.id;
  });

  it('gives a plan a version and a north, both starting at zero', async () => {
    const [plan] = await db.select().from(sitePlans).where(eq(sitePlans.id, planId));
    expect(plan.version).toBe(0);
    expect(plan.northDeg).toBe(0);
  });

  it('gives an item no height of its own and no lock by default', async () => {
    const [item] = await db.insert(siteItems).values({
      planId, kind: 'tent', label: 'אוהל 1', xCm: 0, yCm: 0, widthCm: 300, depthCm: 300,
    }).returning();
    expect(item.heightCm).toBeNull();
    expect(item.locked).toBe(false);
  });

  it('keeps one default per kind', async () => {
    await db.insert(siteKindDefaults).values({ kind: 'tent', widthCm: 350, depthCm: 300, heightCm: 200 });
    await expect(db.insert(siteKindDefaults).values({ kind: 'tent', widthCm: 400, depthCm: 300, heightCm: 200 }))
      .rejects.toThrow();
    const rows = await db.select().from(siteKindDefaults);
    expect(rows).toEqual([expect.objectContaining({ kind: 'tent', widthCm: 350, insetCm: null })]);
  });
});
