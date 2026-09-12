import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createObligation, listObligations, settleObligation, unnamedObligations } from './obligations';

let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });

const LEAD = 'lead@example.com';
const WHEN = new Date('2026-07-01T00:00:00Z');

describe('obligations', () => {
  it('reproduces חוב יוסף: 15,240 owed, 14,330 offset, 910 left', async () => {
    const id = await createObligation(db, {
      direction: 'camp_owes', partyName: 'יוסף',
      description: 'חוב יוסף', amount: 15240, openedOn: WHEN,
    });
    for (const [amount, note] of [
      [4410, '3 כרטיס + רכב'], [2780, '3 כרטיס לבד'], [1140, 'ביט מאורי'],
      [6000, 'יוסף קארינה יונתן ירין ועילאי'],
    ] as const) {
      await settleObligation(db, {
        obligationId: id, amount, kind: 'offset', note, settledOn: WHEN, recordedBy: LEAD,
      });
    }
    const [row] = await listObligations(db);
    expect(row.amountAgorot).toBe(1524000);
    expect(row.settledAgorot).toBe(1433000);
    expect(row.outstandingAgorot).toBe(91000);
    expect(row.settled).toBe(false);
    expect(row.settlements).toHaveLength(4);
  });

  /**
   * Two of the twelve ברן 25 reimbursements have no name at all. The camp
   * cannot say who to pay back, and the system must keep saying so rather
   * than dropping the row or inventing an owner.
   */
  it('keeps an obligation with no party, and refuses to settle it', async () => {
    const id = await createObligation(db, {
      direction: 'camp_owes', description: 'מקפיא באיחסון נוסף',
      amount: 500, openedOn: WHEN,
    });

    const [row] = await unnamedObligations(db);
    expect(row.id).toBe(id);
    expect(row.unnamed).toBe(true);
    expect(row.displayParty).toBeNull();

    await expect(settleObligation(db, {
      obligationId: id, amount: 500, kind: 'cash', settledOn: WHEN, recordedBy: LEAD,
    })).rejects.toThrow(/בלי שם/);
  });

  it('requires a note on an offset, as recordOffset already does', async () => {
    const id = await createObligation(db, {
      direction: 'camp_owes', partyName: 'יוסף', description: 'חוב',
      amount: 100, openedOn: WHEN,
    });
    await expect(settleObligation(db, {
      obligationId: id, amount: 100, kind: 'offset', note: ' ‏ ',
      settledOn: WHEN, recordedBy: LEAD,
    })).rejects.toThrow(/קיזוז/);
  });

  it('refuses to settle more than is owed', async () => {
    const id = await createObligation(db, {
      direction: 'owed_to_camp', partyName: 'אורי', description: 'חוב',
      amount: 100, openedOn: WHEN,
    });
    await settleObligation(db, {
      obligationId: id, amount: 60, kind: 'offset', note: 'חלקי',
      settledOn: WHEN, recordedBy: LEAD,
    });
    await expect(settleObligation(db, {
      obligationId: id, amount: 50, kind: 'offset', note: 'יותר מדי',
      settledOn: WHEN, recordedBy: LEAD,
    })).rejects.toThrow(/יותר/);
  });

  /**
   * `יוסף` has a recorded name but no confident link to a `persons` row.
   * That is a known creditor, not a mystery one — `unnamed` must read
   * `partyName` and not only `partyPersonId`, or he'd land in the same
   * "nobody knows who to pay" queue as the two truly nameless rows.
   */
  it('does not treat a named-but-unlinked party as unnamed', async () => {
    await createObligation(db, {
      direction: 'camp_owes', partyName: 'יוסף',
      description: 'חוב יוסף', amount: 15240, openedOn: WHEN,
    });
    const [row] = await listObligations(db);
    expect(row.unnamed).toBe(false);
    expect(await unnamedObligations(db)).toHaveLength(0);
  });

  it('separates the two directions', async () => {
    await createObligation(db, {
      direction: 'camp_owes', partyName: 'יוסף', description: 'א', amount: 10, openedOn: WHEN,
    });
    await createObligation(db, {
      direction: 'owed_to_camp', partyName: 'רן', description: 'ב', amount: 20, openedOn: WHEN,
    });
    expect(await listObligations(db, { direction: 'camp_owes' })).toHaveLength(1);
    expect(await listObligations(db, { direction: 'owed_to_camp' })).toHaveLength(1);
  });
});
