import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import {
  issueFlatDues, issueFlatDueFor, setException, clearException, listDues,
  setFlatRate, issuedFlatDues,
} from '@/lib/fees/dues';
import { recordPayment } from '@/lib/fees/payments';
import { listSeasons } from '@/lib/members/roster';

const LEAD = 'lead@shliff.camp';

describe('dues', () => {
  let db: TestDb;
  let seasonId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const season = await createSeason(db, {
      name: 'ברן 25', year: 2025, flatRate: 1500, plannedSize: 43,
    });
    seasonId = season.id;
  });

  async function member(name: string) {
    const id = await createPerson(db, name, LEAD);
    await addMember(db, id, seasonId);
    return id;
  }

  it('issues the flat rate to everyone on the roster', async () => {
    await member('אופק');
    await member('יוסף');
    expect(await issueFlatDues(db, seasonId)).toBe(2);

    const rows = await listDues(db, seasonId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.amountAgorot === 150000)).toBe(true);
    expect(rows.every((r) => r.kind === 'flat')).toBe(true);
  });

  it('is idempotent — re-issuing does not overwrite or duplicate', async () => {
    const ofek = await member('אופק');
    await issueFlatDues(db, seasonId);
    await setException(db, {
      personId: ofek, seasonId, amount: 0,
      reason: 'עבודה במקום תשלום', decidedBy: LEAD,
    });

    expect(await issueFlatDues(db, seasonId)).toBe(0);
    const rows = await listDues(db, seasonId);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountAgorot).toBe(0);
  });

  it('records an exception with its reason and decider', async () => {
    const amiram = await member('עמירם דהן');
    await issueFlatDues(db, seasonId);
    await setException(db, {
      personId: amiram, seasonId, amount: 0,
      reason: 'פטור מלא — הוביל את ההקמה', decidedBy: LEAD,
    });

    const [row] = await listDues(db, seasonId);
    expect(row.kind).toBe('exception');
    expect(row.amountAgorot).toBe(0);
    expect(row.exceptionReason).toBe('פטור מלא — הוביל את ההקמה');
    expect(row.decidedBy).toBe(LEAD);
  });

  it('refuses an exception with no reason', async () => {
    const person = await member('עמירם דהן');
    await issueFlatDues(db, seasonId);
    await expect(setException(db, {
      personId: person, seasonId, amount: 0, reason: '   ', decidedBy: LEAD,
    })).rejects.toThrow(/reason/);
  });

  it('refuses an exception with no decider', async () => {
    const person = await member('עמירם דהן');
    await issueFlatDues(db, seasonId);
    await expect(setException(db, {
      personId: person, seasonId, amount: 0, reason: 'פטור', decidedBy: '',
    })).rejects.toThrow(/decided/);
  });

  /**
   * `.trim()` does not strip LRM, RLM or zero-width marks, and this is an RTL
   * admin UI where a browser injects those invisibly on copy-paste. A reason
   * made only of them looks blank to a human and passes a trim check — which
   * would record a materially empty reason as if it were real, the exact
   * failure this refusal exists to prevent.
   */
  it('refuses a reason that is only invisible directional marks', async () => {
    const person = await member('עמירם דהן');
    await issueFlatDues(db, seasonId);
    await expect(setException(db, {
      personId: person, seasonId, amount: 0,
      reason: '\u200e\u200f\u200b', decidedBy: LEAD,
    })).rejects.toThrow(/reason/);
  });

  it('refuses a negative amount', async () => {
    const person = await member('אופק');
    await issueFlatDues(db, seasonId);
    await expect(setException(db, {
      personId: person, seasonId, amount: -100, reason: 'טעות', decidedBy: LEAD,
    })).rejects.toThrow(/negative/);
  });

  it('restores the flat rate when an exception is cleared', async () => {
    const person = await member('עזריאל');
    await issueFlatDues(db, seasonId);
    await setException(db, {
      personId: person, seasonId, amount: 1000, reason: 'הנחה', decidedBy: LEAD,
    });
    await clearException(db, person, seasonId);

    const [row] = await listDues(db, seasonId);
    expect(row.kind).toBe('flat');
    expect(row.amountAgorot).toBe(150000);
    expect(row.exceptionReason).toBeNull();
    // The decider must go too — an exception's approver has no meaning once
    // the person is back on the flat rate.
    expect(row.decidedBy).toBeNull();
  });

  it('refuses to clear an exception that does not exist', async () => {
    const person = await member('אופק');
    // No issueFlatDues, so there is no due row to clear.
    await expect(clearException(db, person, seasonId))
      .rejects.toThrow(/nothing to clear/);
  });

  it('issues a due to one member without touching anyone else', async () => {
    const ofek = await member('אופק');
    await member('יוסף');

    expect(await issueFlatDueFor(db, ofek, seasonId)).toBe(true);

    const rows = await listDues(db, seasonId);
    expect(rows).toHaveLength(1);
    expect(rows[0].displayName).toBe('אופק');
    expect(rows[0].amountAgorot).toBe(150000);
  });

  it('is a no-op when that member already has a due', async () => {
    const ofek = await member('אופק');
    await issueFlatDueFor(db, ofek, seasonId);
    expect(await issueFlatDueFor(db, ofek, seasonId)).toBe(false);
    expect(await listDues(db, seasonId)).toHaveLength(1);
  });

  it('refuses to issue a due to someone not on the roster', async () => {
    const stranger = await createPerson(db, 'זר', LEAD);
    await expect(issueFlatDueFor(db, stranger, seasonId))
      .rejects.toThrow(/not on this season roster/);
  });

  it('reproduces ברן 25: 38 flat + 5 exceptions = 60,955', async () => {
    for (let i = 0; i < 38; i += 1) await member(`חבר ${i}`);
    const exceptions: Array<[string, number]> = [
      ['עזריאל', 1000], ['עדי', 1000], ['דניאל פינטו', 555],
      ['דנה שרון', 1400], ['עמירם דהן', 0],
    ];
    const ids = new Map<string, string>();
    for (const [name] of exceptions) ids.set(name, await member(name));

    await issueFlatDues(db, seasonId);
    for (const [name, amount] of exceptions) {
      await setException(db, {
        personId: ids.get(name)!, seasonId, amount,
        reason: 'חריג מברן 25', decidedBy: LEAD,
      });
    }

    const rows = await listDues(db, seasonId);
    expect(rows).toHaveLength(43);
    expect(rows.filter((r) => r.kind === 'flat')).toHaveLength(38);
    expect(rows.filter((r) => r.kind === 'exception')).toHaveLength(5);
    const total = rows.reduce((sum, r) => sum + r.amountAgorot, 0);
    expect(total).toBe(6095500);
  });
});

/**
 * The rate is what future dues are issued at; a due already out carries its
 * own amount. Whether the change follows through to them is the lead's call,
 * made out loud, and an exception is never on the rate to begin with.
 */
describe('setFlatRate', () => {
  let db: TestDb;
  let seasonId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    seasonId = season.id;
  });

  async function member(name: string) {
    const id = await createPerson(db, name, LEAD);
    await addMember(db, id, seasonId);
    return id;
  }

  it('changes what the next due is issued at, and reports the old and new rate', async () => {
    const change = await setFlatRate(db, seasonId, 1350, { applyToIssued: false });
    expect(change).toEqual({ previousAgorot: 120000, nextAgorot: 135000, updatedDues: 0 });

    const [season] = await listSeasons(db);
    expect(season.flatRate).toBe('1350.00');

    await member('אופק');
    await issueFlatDues(db, seasonId);
    expect((await listDues(db, seasonId))[0].amountAgorot).toBe(135000);
  });

  it('leaves the dues already out alone unless asked', async () => {
    await member('אופק');
    await issueFlatDues(db, seasonId);

    await setFlatRate(db, seasonId, 1350, { applyToIssued: false });
    expect((await listDues(db, seasonId))[0].amountAgorot).toBe(120000);
  });

  it('rewrites the flat dues when asked, and never an exception', async () => {
    const ofek = await member('אופק');
    await member('יוסף');
    const amiram = await member('עמירם');
    await issueFlatDues(db, seasonId);
    await setException(db, {
      personId: amiram, seasonId, amount: 0, reason: 'פטור מלא', decidedBy: LEAD,
    });

    const change = await setFlatRate(db, seasonId, 1350, { applyToIssued: true });
    expect(change.updatedDues).toBe(2);

    const rows = await listDues(db, seasonId);
    const byPerson = new Map(rows.map((row) => [row.personId, row]));
    expect(byPerson.get(ofek)?.amountAgorot).toBe(135000);
    expect(byPerson.get(amiram)?.amountAgorot).toBe(0);
    expect(byPerson.get(amiram)?.kind).toBe('exception');
  });

  it('allows zero — a season run without dues — and refuses less', async () => {
    await expect(setFlatRate(db, seasonId, 0, { applyToIssued: false })).resolves.toMatchObject({ nextAgorot: 0 });
    await expect(setFlatRate(db, seasonId, -1, { applyToIssued: false }))
      .rejects.toThrow('a flat rate may not be negative');
    await expect(setFlatRate(db, seasonId, Number.NaN, { applyToIssued: false }))
      .rejects.toThrow('a flat rate must be a number');
  });

  it('refuses a season that does not exist', async () => {
    await expect(setFlatRate(db, '00000000-0000-4000-8000-000000000000', 1000, { applyToIssued: false }))
      .rejects.toThrow('unknown season');
  });

  it('counts the flat dues out, and how many of them carry money', async () => {
    expect(await issuedFlatDues(db, seasonId)).toEqual({ count: 0, withPayments: 0 });

    await member('אופק');
    await member('יוסף');
    const amiram = await member('עמירם');
    await issueFlatDues(db, seasonId);
    await setException(db, {
      personId: amiram, seasonId, amount: 0, reason: 'פטור מלא', decidedBy: LEAD,
    });
    const [first] = await listDues(db, seasonId);
    await recordPayment(db, {
      dueId: first.dueId, amount: 500, channel: 'ביט', paidOn: new Date('2026-05-01'), recordedBy: LEAD,
    });
    await recordPayment(db, {
      dueId: first.dueId, amount: 200, channel: 'מזומן', paidOn: new Date('2026-05-02'), recordedBy: LEAD,
    });

    // Two payments on one due count once; the exception is not counted at all.
    expect(await issuedFlatDues(db, seasonId)).toEqual({ count: 2, withPayments: 1 });
  });
});
