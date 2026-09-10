import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues, listDues, setException } from '@/lib/fees/dues';
import { recordPayment } from '@/lib/fees/payments';
import { seasonFeeSummary } from '@/lib/fees/summary';

const LEAD = 'lead@shliff.camp';
const WHEN = new Date('2026-07-01T00:00:00Z');

describe('seasonFeeSummary', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('reproduces ברן 25 — 38 רגילים, 5 חריגים, 60,955 expected', async () => {
    const season = await createSeason(db, {
      name: 'ברן 25', year: 2025, flatRate: 1500, plannedSize: 43,
    });
    const ids: string[] = [];
    for (let i = 0; i < 38; i += 1) {
      const id = await createPerson(db, `חבר ${i}`, LEAD);
      await addMember(db, id, season.id);
      ids.push(id);
    }
    const exceptions: Array<[string, number]> = [
      ['עזריאל', 1000], ['עדי', 1000], ['דניאל פינטו', 555],
      ['דנה שרון', 1400], ['עמירם דהן', 0],
    ];
    for (const [name] of exceptions) {
      const id = await createPerson(db, name, LEAD);
      await addMember(db, id, season.id);
      ids.push(id);
    }
    await issueFlatDues(db, season.id);
    const rows = await listDues(db, season.id);
    for (const [name, amount] of exceptions) {
      const row = rows.find((r) => r.displayName === name)!;
      await setException(db, {
        personId: row.personId, seasonId: season.id, amount,
        reason: 'חריג מברן 25', decidedBy: LEAD,
      });
    }

    const summary = await seasonFeeSummary(db, season.id);
    expect(summary.memberCount).toBe(43);
    expect(summary.flatCount).toBe(38);
    expect(summary.exceptionCount).toBe(5);
    expect(summary.expectedAgorot).toBe(6095500);
    expect(summary.collectedAgorot).toBe(0);
    expect(summary.outstandingAgorot).toBe(6095500);
  });

  it('reproduces the ברן 26 plan — 35 × 1,200 = 42,000', async () => {
    const season = await createSeason(db, {
      name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35,
    });
    for (let i = 0; i < 35; i += 1) {
      const id = await createPerson(db, `חבר ${i}`, LEAD);
      await addMember(db, id, season.id);
    }
    await issueFlatDues(db, season.id);

    const summary = await seasonFeeSummary(db, season.id);
    expect(summary.expectedAgorot).toBe(4200000);
    expect(summary.memberCount).toBe(35);
  });

  it('counts collected money and who is still unpaid', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    for (const name of ['אופק', 'יוסף', 'ירין']) {
      const id = await createPerson(db, name, LEAD);
      await addMember(db, id, season.id);
    }
    await issueFlatDues(db, season.id);
    const rows = await listDues(db, season.id);
    await recordPayment(db, {
      dueId: rows[0].dueId, amount: 1200, channel: 'ביט', paidOn: WHEN, recordedBy: LEAD,
    });
    await recordPayment(db, {
      dueId: rows[1].dueId, amount: 600, channel: 'מזומן', paidOn: WHEN, recordedBy: LEAD,
    });

    const summary = await seasonFeeSummary(db, season.id);
    expect(summary.expectedAgorot).toBe(360000);
    expect(summary.collectedAgorot).toBe(180000);
    expect(summary.outstandingAgorot).toBe(180000);
    expect(summary.unpaidCount).toBe(2);
  });

  it('names roster members who have no due at all rather than hiding them', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const withDue = await createPerson(db, 'אופק', LEAD);
    await addMember(db, withDue, season.id);
    await issueFlatDues(db, season.id);

    const without = await createPerson(db, 'עמירם דהן', LEAD);
    await addMember(db, without, season.id);

    const summary = await seasonFeeSummary(db, season.id);
    expect(summary.memberCount).toBe(2);
    expect(summary.missingDues).toEqual(['עמירם דהן']);
  });
});
