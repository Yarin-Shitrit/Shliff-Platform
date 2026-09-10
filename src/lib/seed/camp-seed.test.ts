import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { getSeasonByName, listRoster } from '@/lib/members/roster';
import { resolveName, listUnlinkedNames } from '@/lib/members/identity';
import { listDues } from '@/lib/fees/dues';
import { seasonFeeSummary } from '@/lib/fees/summary';
import { listEvents } from '@/lib/work/events';
import { responsibilitiesOf } from '@/lib/work/coverage';
import { personDossier } from '@/lib/members/dossier';
import { seedCampBaseline } from '@/lib/seed/camp-seed';

const LEAD = 'lead@shliff.camp';

describe('seedCampBaseline', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('seeds the two seasons whose rates the workbooks state', async () => {
    await seedCampBaseline(db, LEAD);
    const s25 = await getSeasonByName(db, 'ברן 25');
    const s26 = await getSeasonByName(db, 'ברן 26');
    expect(s25?.flatRate).toBe('1500.00');
    expect(s25?.plannedSize).toBe(43);
    expect(s26?.flatRate).toBe('1200.00');
    expect(s26?.plannedSize).toBe(35);
    // ברן 23 and ברן 24 have no recorded rate — not invented.
    expect(await getSeasonByName(db, 'ברן 23')).toBeUndefined();
  });

  it('is idempotent', async () => {
    const first = await seedCampBaseline(db, LEAD);
    const second = await seedCampBaseline(db, LEAD);
    expect(second.seasons).toBe(0);
    expect(second.people).toBe(0);
    expect(second.tasks).toBe(0);
    expect(first.people).toBeGreaterThan(0);
  });

  it('queues ראנצ׳ו ונטלי instead of splitting or guessing', async () => {
    await seedCampBaseline(db, LEAD);
    const queue = await listUnlinkedNames(db);
    expect(queue.map((q) => q.alias)).toContain('ראנצ׳ו ונטלי');
    expect((await resolveName(db, 'ראנצ׳ו ונטלי')).personId).toBeNull();
  });

  it('keeps דניאל פינטו and דניאל ענבר as two people', async () => {
    await seedCampBaseline(db, LEAD);
    const pinto = await resolveName(db, 'דניאל פינטו');
    const inbar = await resolveName(db, 'דניאל ענבר');
    expect(pinto.personId).not.toBeNull();
    expect(inbar.personId).not.toBeNull();
    expect(pinto.personId).not.toBe(inbar.personId);
  });

  it('records the five ברן 25 exceptions with their amounts', async () => {
    await seedCampBaseline(db, LEAD);
    const season = (await getSeasonByName(db, 'ברן 25'))!;
    const rows = await listDues(db, season.id);
    const exceptions = rows.filter((r) => r.kind === 'exception');

    expect(exceptions).toHaveLength(5);
    const byName = new Map(exceptions.map((r) => [r.displayName, r.amountAgorot]));
    expect(byName.get('עזריאל')).toBe(100000);
    expect(byName.get('עדי')).toBe(100000);
    expect(byName.get('דניאל פינטו')).toBe(55500);
    expect(byName.get('דנה שרון')).toBe(140000);
    expect(byName.get('עמירם דהן')).toBe(0);
    // Every one carries a reason — that is the point.
    expect(exceptions.every((r) => (r.exceptionReason ?? '').length > 0)).toBe(true);
  });

  it('settles the five ברן 26 dues through one 6,000 offset', async () => {
    await seedCampBaseline(db, LEAD);
    const season = (await getSeasonByName(db, 'ברן 26'))!;
    const summary = await seasonFeeSummary(db, season.id);

    expect(summary.collectedAgorot).toBe(600000);
    expect(summary.memberCount).toBe(5);
    expect(summary.unpaidCount).toBe(0);

    const yosef = await resolveName(db, 'יוסף');
    const dossier = await personDossier(db, yosef.personId!);
    const due26 = dossier!.dues.find((d) => d.seasonName === 'ברן 26')!;
    expect(due26.settled).toBe(true);
  });

  it('gives אופק both of his ברן 25 deliverables', async () => {
    await seedCampBaseline(db, LEAD);
    const ofek = await resolveName(db, 'אופק');
    const owned = await responsibilitiesOf(db, ofek.personId!);

    expect(owned.map((r) => r.title).sort()).toEqual(['הובלה', 'חשמל']);
    expect(owned.find((r) => r.title === 'חשמל')?.budgetAgorot).toBe(1295000);
    expect(owned.find((r) => r.title === 'הובלה')?.budgetAgorot).toBe(400000);
  });

  it('seeds the fundraising events for both seasons', async () => {
    await seedCampBaseline(db, LEAD);
    const s25 = (await getSeasonByName(db, 'ברן 25'))!;
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;

    expect((await listEvents(db, s25.id)).map((e) => e.name))
      .toContain('Halloween Underground 311025');
    expect((await listEvents(db, s26.id)).map((e) => e.name))
      .toContain('מסיבת פקאנים');
  });

  it('puts only evidenced people on the ברן 25 roster', async () => {
    await seedCampBaseline(db, LEAD);
    const season = (await getSeasonByName(db, 'ברן 25'))!;
    const roster = await listRoster(db, season.id);
    // The 38 anonymous רגילים stay a count on the season, not invented rows.
    expect(roster.length).toBeLessThan(38);
    expect(roster.map((r) => r.displayName)).toContain('אופק');
  });
});
