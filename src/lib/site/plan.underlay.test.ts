import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { seasons } from '@/db/schema/camp';
import { sitePlans, siteUnderlays } from '@/db/schema/site';
import { applySiteOps, copyPlan, createPlan, listItems, loadDoc, planForSeason, readUnderlay } from './plan';
import type { EditorItem, EditorUnderlay } from './editor/model';
import { underlayKey } from './underlay-limits';

const LEAD = 'lead@shliff.camp';
const OTHER_LEAD = 'other@shliff.camp';
const PLOT = { widthCm: 2600, depthCm: 2400, gridCm: 50 };
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

/** A picture uploaded to `planId`, where a new one lies: centred on the 26 × 24 m plot, as wide as it. */
function imageOn(planId: string, over: Partial<EditorUnderlay> = {}): EditorUnderlay {
  return {
    storageKey: underlayKey(planId, SHA_A, 'png'), contentType: 'image/png', sizeBytes: 812_345, filename: 'שרטוט המגרש.png',
    centreXCm: 1300, centreYCm: 1200, widthCm: 2600, rotationTenths: 0, calibration: null, ...over,
  };
}

describe('site_underlays, the migration', () => {
  let db: TestDb;
  let planId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const [season] = await db.insert(seasons).values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    planId = await createPlan(db, season.id, PLOT, LEAD);
  });

  it('holds one picture per plan, unturned unless told, and none once the plan is gone', async () => {
    const row = {
      planId, storageKey: underlayKey(planId, SHA_A, 'png'), contentType: 'image/png' as const, sizeBytes: 10,
      filename: 'a.png', centreXCm: 0, centreYCm: 0, widthCm: 100,
    };
    await db.insert(siteUnderlays).values(row);
    const [stored] = await db.select().from(siteUnderlays);
    expect(stored).toMatchObject({ rotationTenths: 0, calibration: null, uploadedBy: null, updatedBy: null });
    await expect(db.insert(siteUnderlays).values({ ...row, storageKey: underlayKey(planId, SHA_B, 'png') })).rejects.toThrow();
    await db.delete(sitePlans).where(eq(sitePlans.id, planId));
    expect(await db.select().from(siteUnderlays)).toEqual([]);
  });
});

describe('the picture under a map', () => {
  let db: TestDb;
  let s25: string;
  let s26: string;
  let planId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const rows = await db.insert(seasons).values([
      { name: 'ברן 25', year: 2025, flatRate: '1500.00' },
      { name: 'ברן 26', year: 2026, flatRate: '1200.00' },
    ]).returning();
    s25 = rows[0].id;
    s26 = rows[1].id;
    planId = await createPlan(db, s26, PLOT, LEAD);
  });

  it('is none on a new map, and the editor’s doc says so', async () => {
    expect(await readUnderlay(db, planId)).toBeNull();
    expect((await loadDoc(db, planId))?.doc.underlay).toBeNull();
  });

  it('goes on the map in a saved batch, and comes back with the map — turn, calibration and all', async () => {
    const image = imageOn(planId, { rotationTenths: 37, calibration: { from: [0.1234, 0.5], to: [0.9, 0.5], distanceCm: 2600 } });
    expect(await applySiteOps(db, planId, 0, [{ type: 'setUnderlay', underlay: image }], LEAD)).toEqual({ status: 'saved', version: 1, skipped: [] });
    const loaded = await loadDoc(db, planId);
    expect(loaded?.version).toBe(1);
    expect(loaded?.doc.underlay).toEqual(image);
  });

  it('moves, and comes off the map, a version each', async () => {
    await applySiteOps(db, planId, 0, [{ type: 'setUnderlay', underlay: imageOn(planId) }], LEAD);
    await applySiteOps(db, planId, 1, [{ type: 'setUnderlay', underlay: imageOn(planId, { centreXCm: 1500 }) }], LEAD);
    expect((await readUnderlay(db, planId))?.centreXCm).toBe(1500);
    expect(await applySiteOps(db, planId, 2, [{ type: 'setUnderlay', underlay: null }], LEAD)).toEqual({ status: 'saved', version: 3, skipped: [] });
    expect(await readUnderlay(db, planId)).toBeNull();
  });

  it('refuses a file uploaded to another map, and writes nothing', async () => {
    const other = await createPlan(db, s25, PLOT, LEAD);
    await expect(applySiteOps(db, planId, 0, [{ type: 'setUnderlay', underlay: imageOn(other) }], LEAD))
      .rejects.toThrow('an underlay file must be');
    expect(await readUnderlay(db, planId)).toBeNull();
    expect((await planForSeason(db, s26))?.version).toBe(0);
  });

  it('refuses a batch whole when the picture in it is malformed', async () => {
    const tent: EditorItem = {
      id: crypto.randomUUID(), kind: 'tent', label: 'אוהל 1', xCm: 100, yCm: 100, widthCm: 300, depthCm: 300,
      heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ropeAngleDeg: null,
    };
    await expect(applySiteOps(db, planId, 0, [
      { type: 'add', item: tent },
      { type: 'setUnderlay', underlay: imageOn(planId, { centreXCm: 12.5 }) },
    ], LEAD)).rejects.toThrow('an underlay placement must be');
    expect(await listItems(db, planId)).toEqual([]);
    expect((await planForSeason(db, s26))?.version).toBe(0);
  });

  it('answers a stale version with a conflict, as for items, and writes nothing', async () => {
    await applySiteOps(db, planId, 0, [{ type: 'setUnderlay', underlay: imageOn(planId) }], LEAD);
    expect(await applySiteOps(db, planId, 0, [{ type: 'setUnderlay', underlay: imageOn(planId, { widthCm: 900 }) }], OTHER_LEAD))
      .toEqual({ status: 'conflict', version: 1 });
    expect((await readUnderlay(db, planId))?.widthCm).toBe(2600);
  });

  it('says who uploaded the file, and changes that only when the file changes', async () => {
    await applySiteOps(db, planId, 0, [{ type: 'setUnderlay', underlay: imageOn(planId) }], LEAD);
    await applySiteOps(db, planId, 1, [{ type: 'setUnderlay', underlay: imageOn(planId, { rotationTenths: 900 }) }], OTHER_LEAD);
    let [row] = await db.select().from(siteUnderlays);
    expect(row).toMatchObject({ uploadedBy: LEAD, updatedBy: OTHER_LEAD, rotationTenths: 900 });
    const firstUpload = row.uploadedAt;

    await applySiteOps(db, planId, 2, [{
      type: 'setUnderlay',
      underlay: imageOn(planId, { storageKey: underlayKey(planId, SHA_B, 'jpg'), contentType: 'image/jpeg', filename: 'IMG_2231.jpg' }),
    }], OTHER_LEAD);
    [row] = await db.select().from(siteUnderlays);
    expect(row.uploadedBy).toBe(OTHER_LEAD);
    expect(row.uploadedAt.getTime()).toBeGreaterThanOrEqual(firstUpload.getTime());
  });

  it('keeps the file name trimmed', async () => {
    await applySiteOps(db, planId, 0, [{ type: 'setUnderlay', underlay: imageOn(planId, { filename: '  שרטוט.png ' }) }], LEAD);
    expect((await readUnderlay(db, planId))?.filename).toBe('שרטוט.png');
  });

  it('is not copied with last year’s map: last year’s sketch is not this year’s plot', async () => {
    await applySiteOps(db, planId, 0, [{ type: 'setUnderlay', underlay: imageOn(planId) }], LEAD);
    const [s27] = await db.insert(seasons).values({ name: 'ברן 27', year: 2027, flatRate: '1300.00' }).returning();
    const copied = await copyPlan(db, s26, s27.id, LEAD);
    expect(await readUnderlay(db, copied)).toBeNull();
    expect((await loadDoc(db, copied))?.doc.underlay).toBeNull();
    expect(await readUnderlay(db, planId)).not.toBeNull();
  });
});
