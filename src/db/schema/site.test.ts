import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { seasons } from './camp';
import { siteItems, siteKindDefaults, siteLines, sitePlans } from './site';

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

describe('site schema, migration 0013 — the lines', () => {
  let db: TestDb;
  let planId: string;
  let tankId: string;
  let showerId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const [season] = await db.insert(seasons).values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    const [plan] = await db.insert(sitePlans).values({ seasonId: season.id, widthCm: 2600, depthCm: 2400 }).returning();
    planId = plan.id;
    const rows = await db.insert(siteItems).values([
      { planId, kind: 'water', label: 'מי שתייה 1', xCm: 0, yCm: 0, widthCm: 100, depthCm: 100 },
      { planId, kind: 'shower', label: 'מקלחת 1', xCm: 500, yCm: 0, widthCm: 100, depthCm: 100 },
    ]).returning();
    tankId = rows[0].id;
    showerId = rows[1].id;
  });

  it('gives a line no bends and sort 0 by default, and reads the bends back as pairs', async () => {
    const [line] = await db.insert(siteLines).values({
      planId, kind: 'water', label: 'צינור מים 1', fromItemId: tankId, toItemId: showerId,
    }).returning();
    expect(line.pointsCm).toEqual([]);
    expect(line.sort).toBe(0);
    await db.update(siteLines).set({ pointsCm: [[50, 300], [550, 300]] }).where(eq(siteLines.id, line.id));
    const [read] = await db.select().from(siteLines).where(eq(siteLines.id, line.id));
    expect(read.pointsCm).toEqual([[50, 300], [550, 300]]);
  });

  it('goes with the item at either end', async () => {
    await db.insert(siteLines).values({ planId, kind: 'water', label: 'צינור מים 1', fromItemId: tankId, toItemId: showerId });
    await db.delete(siteItems).where(eq(siteItems.id, showerId));
    expect(await db.select().from(siteLines)).toEqual([]);
  });

  it('refuses an end that is not an item', async () => {
    await expect(db.insert(siteLines).values({
      planId, kind: 'water', label: 'צינור מים 1', fromItemId: tankId, toItemId: '00000000-0000-4000-8000-000000000000',
    })).rejects.toThrow();
  });
});
