import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason, addMember, removeMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues, listDues, setException } from '@/lib/fees/dues';
import { recordPayment } from '@/lib/fees/payments';
import { createAccount } from '@/lib/money/accounts';
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

  /**
   * The clamp exists so a season total can never read negative. Without it,
   * one member paying more than they owe would subtract from what the rest of
   * the camp still owes and print a nonsense figure.
   */
  it('never reports a negative season total when someone overpays', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    for (const name of ['אופק', 'יוסף']) {
      const id = await createPerson(db, name, LEAD);
      await addMember(db, id, season.id);
    }
    await issueFlatDues(db, season.id);
    const rows = await listDues(db, season.id);
    // 2,400 against a 1,200 due, plus a second member paying in full.
    await recordPayment(db, {
      dueId: rows[0].dueId, amount: 2400, channel: 'העברה', paidOn: WHEN, recordedBy: LEAD,
    });
    await recordPayment(db, {
      dueId: rows[1].dueId, amount: 1200, channel: 'מזומן', paidOn: WHEN, recordedBy: LEAD,
    });

    const summary = await seasonFeeSummary(db, season.id);
    expect(summary.expectedAgorot).toBe(240000);
    expect(summary.collectedAgorot).toBe(360000);
    expect(summary.outstandingAgorot).toBe(0);
  });

  /**
   * An overpayment makes the season total read zero while a member still owes.
   * That is not a bug in the total — it is arithmetic — but it means the total
   * alone cannot be trusted to show whether everyone has paid. unpaidCount is
   * the figure that survives it, and this test pins that relationship.
   */
  it('still counts an unpaid member when an overpayment hides them in the total', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    for (const name of ['אופק', 'יוסף']) {
      const id = await createPerson(db, name, LEAD);
      await addMember(db, id, season.id);
    }
    await issueFlatDues(db, season.id);
    const rows = await listDues(db, season.id);
    await recordPayment(db, {
      dueId: rows[0].dueId, amount: 2400, channel: 'העברה', paidOn: WHEN, recordedBy: LEAD,
    });

    const summary = await seasonFeeSummary(db, season.id);
    expect(summary.outstandingAgorot).toBe(0);
    expect(summary.unpaidCount).toBe(1);
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

  it('sorts the missing-dues names rather than returning insertion order', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const withDue = await createPerson(db, 'אופק', LEAD);
    await addMember(db, withDue, season.id);
    await issueFlatDues(db, season.id);

    // Added deliberately out of order, so insertion order and sorted order differ.
    for (const name of ['תומר גולן', 'דנה שרון', 'איתן']) {
      const id = await createPerson(db, name, LEAD);
      await addMember(db, id, season.id);
    }

    const summary = await seasonFeeSummary(db, season.id);
    expect(summary.missingDues).toEqual(['איתן', 'דנה שרון', 'תומר גולן']);
  });

  it('reports how much of the collection came through קיזוז, and from how many', async () => {
    const season = await createSeason(db, {
      name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35,
    });
    const names = ['יוסף', 'קארינה', 'יונתן', 'ירין', 'עילאי', 'אופק'];
    for (const name of names) {
      const id = await createPerson(db, name, LEAD);
      await addMember(db, id, season.id);
    }
    await issueFlatDues(db, season.id);
    const rows = await listDues(db, season.id);

    // The real ברן 26 line: five dues settled against one debt the camp owed.
    for (const name of names.slice(0, 5)) {
      const due = rows.find((r) => r.displayName === name)!;
      await recordPayment(db, {
        dueId: due.dueId, amount: 1200, channel: 'קיזוז', paidOn: WHEN,
        note: 'חוב יוסף — יוסף קארינה יונתן ירין ועילאי 6,000', recordedBy: LEAD,
      });
    }
    const cash = rows.find((r) => r.displayName === 'אופק')!;
    await recordPayment(db, {
      dueId: cash.dueId, amount: 1200, channel: 'מזומן', paidOn: WHEN, recordedBy: LEAD,
    });

    const summary = await seasonFeeSummary(db, season.id);
    expect(summary.collectedAgorot).toBe(720000);
    expect(summary.offsetAgorot).toBe(600000);
    expect(summary.offsetPersonCount).toBe(5);
  });

  it('reports dues money received with no קופה, and leaves קיזוז out of it', async () => {
    const season = await createSeason(db, {
      name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35,
    });
    const account = await createAccount(db, { name: 'קופת מזומן', kind: 'cash' });
    for (const name of ['אופק', 'לטם', 'יוסף']) {
      const id = await createPerson(db, name, LEAD);
      await addMember(db, id, season.id);
    }
    await issueFlatDues(db, season.id);
    const rows = await listDues(db, season.id);
    const dueFor = (name: string) => rows.find((r) => r.displayName === name)!.dueId;

    await recordPayment(db, {
      dueId: dueFor('אופק'), amount: 1200, channel: 'מזומן', paidOn: WHEN,
      recordedBy: LEAD, accountId: account.id,
    });
    await recordPayment(db, {
      dueId: dueFor('לטם'), amount: 500, channel: 'ביט', paidOn: WHEN, recordedBy: LEAD,
    });
    await recordPayment(db, {
      dueId: dueFor('יוסף'), amount: 1200, channel: 'קיזוז', paidOn: WHEN,
      note: 'חוב יוסף', recordedBy: LEAD,
    });

    const summary = await seasonFeeSummary(db, season.id);
    expect(summary.unattributedAgorot).toBe(50000);
  });

  it('reports zeroes for a season where nothing was offset or misfiled', async () => {
    const season = await createSeason(db, {
      name: 'ברן 24', year: 2024, flatRate: 1000, plannedSize: 2,
    });
    const id = await createPerson(db, 'נועה', LEAD);
    await addMember(db, id, season.id);
    await issueFlatDues(db, season.id);

    const summary = await seasonFeeSummary(db, season.id);
    expect(summary.offsetAgorot).toBe(0);
    expect(summary.offsetPersonCount).toBe(0);
    expect(summary.unattributedAgorot).toBe(0);
  });

  /**
   * I6's fourth field: the row list a lead scans to see who still owes what.
   * Ordering is the whole point — a lead should not have to scan every row to
   * find the largest debt, so this pins descending order rather than
   * insertion order. יוסף is created and paid first, אופק second, so if the
   * result were left in query order (no sort) this would read
   * [יוסף, אופק] instead of the expected [אופק, יוסף].
   */
  it('lists unpaid members largest outstanding first', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const names = ['יוסף', 'אופק', 'ירין'];
    const ids: Record<string, string> = {};
    for (const name of names) {
      const id = await createPerson(db, name, LEAD);
      await addMember(db, id, season.id);
      ids[name] = id;
    }
    await issueFlatDues(db, season.id);
    const rows = await listDues(db, season.id);
    const dueFor = (name: string) => rows.find((r) => r.displayName === name)!.dueId;

    // יוסף: paid 700 of 1,200 — outstanding 500.
    await recordPayment(db, {
      dueId: dueFor('יוסף'), amount: 700, channel: 'מזומן', paidOn: WHEN, recordedBy: LEAD,
    });
    // אופק: paid nothing — outstanding 1,200.
    // ירין: paid in full — settled, must not appear in `unpaid` at all.
    await recordPayment(db, {
      dueId: dueFor('ירין'), amount: 1200, channel: 'מזומן', paidOn: WHEN, recordedBy: LEAD,
    });

    const summary = await seasonFeeSummary(db, season.id);
    expect(summary.unpaid.map((m) => m.displayName)).toEqual(['אופק', 'יוסף']);
    expect(summary.unpaid[0]).toMatchObject({
      personId: ids['אופק'], displayName: 'אופק', kind: 'flat',
      amountAgorot: 120000, paidAgorot: 0, outstandingAgorot: 120000,
    });
    expect(summary.unpaid[1]).toMatchObject({
      personId: ids['יוסף'], displayName: 'יוסף', kind: 'flat',
      amountAgorot: 120000, paidAgorot: 70000, outstandingAgorot: 50000,
    });
  });

  /**
   * The whole reason for A6's join: someone who left the roster still owing
   * money is the collection case a lead most needs to see, and their due row
   * has no membership row to resolve a name through any more. If the dues
   * read fell back to the roster map for the name (today's behaviour),
   * `displayName` would be missing or the lookup would throw instead of
   * reading 'איתן שלופ'.
   */
  it('gives a name to a due whose person has left the season roster', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const leaverId = await createPerson(db, 'איתן שלופ', LEAD);
    await addMember(db, leaverId, season.id);
    await issueFlatDues(db, season.id);
    await removeMember(db, leaverId, season.id);

    const summary = await seasonFeeSummary(db, season.id);
    expect(summary.memberCount).toBe(0);
    expect(summary.unpaid).toHaveLength(1);
    expect(summary.unpaid[0]).toMatchObject({
      personId: leaverId,
      displayName: 'איתן שלופ',
      outstandingAgorot: 120000,
    });
  });
});
