import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { obligations } from '@/db/schema/money';
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

  /**
   * An RTL browser injects LRM/RLM/zero-width marks invisibly on copy-paste.
   * A `partyName` made of nothing else must land as null — not as a string
   * that makes an obligation *look* named. The `.trim()`-vs-`isBlank` defect
   * behind this was found three times before it got a name; `partyName` is
   * where it does the most damage, since a falsely-named row both escapes
   * `unnamedObligations` and becomes settleable, closing the only record
   * that anyone is owed anything.
   */
  it('treats a partyName of only invisible directional marks as no name', async () => {
    const id = await createObligation(db, {
      direction: 'camp_owes', partyName: '‎‏​',
      description: 'דולב זבל במחסן', amount: 400, openedOn: WHEN,
    });

    const [row] = await listObligations(db);
    expect(row.partyName).toBeNull();
    expect(row.unnamed).toBe(true);
    expect(await unnamedObligations(db)).toHaveLength(1);

    await expect(settleObligation(db, {
      obligationId: id, amount: 400, kind: 'cash', settledOn: WHEN, recordedBy: LEAD,
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

  /**
   * `createObligation` normalises `partyName` with `isBlank` on write, so
   * every row it produces is safe. This inserts straight through
   * `db.insert(obligations)`, bypassing that normalisation entirely, to
   * stand in for Wave 2's promoter or any other future writer that is not
   * `createObligation` — the read side (`unnamed` in `listObligations`, and
   * the settle guard) must not depend on the one writer that happens to be
   * careful. A `partyName` of a lone RLM mark is truthy but carries no
   * visible content; a plain-truthiness check on the read side would let it
   * through as "named" — settleable, and so closeable — for exactly the
   * reason `unnamedObligations` exists to prevent.
   */
  it('treats a directly-inserted row with an invisible-only partyName as unnamed and unsettleable', async () => {
    const [row] = await db.insert(obligations).values({
      direction: 'camp_owes',
      partyName: '‏',
      description: 'שולם 500 — מקפיא באיחסון נוסף',
      amount: '500.00',
      openedOn: WHEN,
    }).returning();

    const [listed] = await listObligations(db);
    expect(listed.unnamed).toBe(true);
    expect(await unnamedObligations(db)).toHaveLength(1);

    await expect(settleObligation(db, {
      obligationId: row.id, amount: 500, kind: 'cash', settledOn: WHEN, recordedBy: LEAD,
    })).rejects.toThrow(/בלי שם/);
  });

  /**
   * `opened_on` is nullable with no default: the workbook does not always say
   * when a debt opened, and a caller must say so explicitly rather than have
   * today's date stamped in for it.
   */
  it('round-trips a null openedOn when the workbook gives no date', async () => {
    const id = await createObligation(db, {
      direction: 'camp_owes', partyName: 'יוסף',
      description: 'חוב יוסף', amount: 100, openedOn: null,
    });
    const [row] = await db.select().from(obligations).where(eq(obligations.id, id));
    expect(row.openedOn).toBeNull();
  });

  it('orders by openedOn ascending with dateless obligations last', async () => {
    await createObligation(db, {
      direction: 'camp_owes', partyName: 'ב', description: 'ב',
      amount: 10, openedOn: null,
    });
    await createObligation(db, {
      direction: 'camp_owes', partyName: 'א', description: 'א',
      amount: 10, openedOn: new Date('2026-01-01T00:00:00Z'),
    });
    await createObligation(db, {
      direction: 'camp_owes', partyName: 'ג', description: 'ג',
      amount: 10, openedOn: new Date('2026-03-01T00:00:00Z'),
    });
    const rows = await listObligations(db);
    expect(rows.map((r) => r.description)).toEqual(['א', 'ג', 'ב']);
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

describe('the date a debt opened', () => {
  it('carries it, and null when the workbook does not say', async () => {
    await createObligation(db, {
      direction: 'camp_owes', partyName: 'אורי', description: 'החזר',
      amount: 300, openedOn: new Date('2026-07-02T00:00:00Z'),
    });
    await createObligation(db, {
      direction: 'camp_owes', partyName: 'תמר גולן', description: 'החזר על מקררים',
      amount: 180, openedOn: null,
    });
    const rows = await listObligations(db, { direction: 'camp_owes' });
    // `asc nulls last` is already the module's own ordering, so the dateless
    // row is second — a screen can tell the two apart only if the field
    // leaves the module at all, which before this it did not.
    expect(rows[0].openedOn?.toISOString()).toBe('2026-07-02T00:00:00.000Z');
    expect(rows[1].openedOn).toBeNull();
  });
});
