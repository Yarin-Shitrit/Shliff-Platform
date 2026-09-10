import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import {
  issueFlatDues, setException, clearException, listDues,
} from '@/lib/fees/dues';

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
