import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues } from '@/lib/fees/dues';
import { recordPayment, recordOffset } from '@/lib/fees/payments';
import { listSeasonFees } from '@/lib/fees/season-fees';
import { createAccount } from './accounts';
import { recordEntry, recordTransfer, listMovements, ledgerTotals } from './ledger';

let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });

const LEAD = 'lead@example.com';

describe('the ledger', () => {
  it('reproduces the ברן 25 bottom line from its eight movements', async () => {
    const rows: Array<[('in' | 'out'), number, string]> = [
      ['in', 44647, 'מעבר לקובץ חדש'],
      ['out', 200, 'תרומה אבישי פרץ'],
      ['out', 8850, 'מכולה אוג 25-26'],
      ['out', 20660, 'מקדמה במה ברן 25'],
      ['in', 34646.55, 'רווח מסיבה נמל'],
      ['out', 20660, 'חצי שני למייצג נטלי'],
      ['out', 400, 'מברגה לקאמפ'],
      ['in', 15660, 'מסיבת האלווין 30/10'],
    ];
    for (const [direction, amount, description] of rows) {
      await recordEntry(db, {
        occurredOn: new Date('2025-06-01T00:00:00Z'),
        direction, amount, description, recordedBy: LEAD,
      });
    }

    const totals = await ledgerTotals(db);
    expect(totals.count).toBe(8);
    expect(totals.outAgorot).toBe(5077000);
    expect(totals.inAgorot).toBe(9495355);
    expect(totals.netAgorot).toBe(4418355);
  });

  it('refuses a non-positive amount, because direction carries the sign', async () => {
    await expect(recordEntry(db, {
      occurredOn: new Date(), direction: 'out', amount: -50,
      description: 'שלילי', recordedBy: LEAD,
    })).rejects.toThrow(/חיובי/);
  });

  it('refuses a zero amount, because a zero movement is not a movement', async () => {
    await expect(recordEntry(db, {
      occurredOn: new Date(), direction: 'out', amount: 0,
      description: 'אפס', recordedBy: LEAD,
    })).rejects.toThrow(/חיובי/);
  });

  it('refuses a blank description', async () => {
    await expect(recordEntry(db, {
      occurredOn: new Date(), direction: 'in', amount: 50,
      description: ' ‎ ', recordedBy: LEAD,
    })).rejects.toThrow(/תיאור/);
  });

  it('writes a transfer as two entries sharing one non-null group', async () => {
    const from = await createAccount(db, { name: 'וייבז', kind: 'event_float', openingBalance: 5000 });
    const to = await createAccount(db, { name: 'קופת מזומן', kind: 'cash' });

    await recordTransfer(db, {
      fromAccountId: from.id, toAccountId: to.id, amount: 1200,
      occurredOn: new Date(), description: 'העברה לקופה', recordedBy: LEAD,
    });

    const moves = await listMovements(db);
    expect(moves).toHaveLength(2);
    expect(new Set(moves.map((m) => m.direction))).toEqual(new Set(['in', 'out']));
    // The actual requirement (§4 requirement 6): a transfer is identifiable
    // as one movement because both its entries carry the *same* group id.
    // `typeof ... === 'string'` rather than `.not.toBeNull()`: a field the
    // select statement forgets to project comes back `undefined`, and
    // `undefined` passes a bare not-null check just as easily as a real
    // UUID would — this would have let `transferGroupId` go on being
    // selected nowhere and still pass.
    expect(typeof moves[0].transferGroupId).toBe('string');
    expect(moves[1].transferGroupId).toBe(moves[0].transferGroupId);
  });

  it('does not share a transfer group between two separate transfers', async () => {
    const a = await createAccount(db, { name: 'וייבז', kind: 'event_float', openingBalance: 5000 });
    const b = await createAccount(db, { name: 'קופת מזומן', kind: 'cash' });
    const c = await createAccount(db, { name: 'עו״ש אופק', kind: 'personal' });

    await recordTransfer(db, {
      fromAccountId: a.id, toAccountId: b.id, amount: 1200,
      occurredOn: new Date('2026-01-01T00:00:00Z'), description: 'העברה ראשונה', recordedBy: LEAD,
    });
    await recordTransfer(db, {
      fromAccountId: b.id, toAccountId: c.id, amount: 300,
      occurredOn: new Date('2026-01-02T00:00:00Z'), description: 'העברה שנייה', recordedBy: LEAD,
    });

    const moves = await listMovements(db);
    expect(moves).toHaveLength(4);
    const firstGroup = moves[0].transferGroupId;
    const secondGroup = moves[2].transferGroupId;
    expect(typeof firstGroup).toBe('string');
    expect(typeof secondGroup).toBe('string');
    expect(secondGroup).not.toBe(firstGroup);
    expect(moves[1].transferGroupId).toBe(firstGroup);
    expect(moves[3].transferGroupId).toBe(secondGroup);
  });

  it('refuses a transfer to the same account', async () => {
    const a = await createAccount(db, { name: 'קופת מזומן', kind: 'cash' });
    await expect(recordTransfer(db, {
      fromAccountId: a.id, toAccountId: a.id, amount: 10,
      occurredOn: new Date(), description: 'עצמי', recordedBy: LEAD,
    })).rejects.toThrow(/אותו חשבון/);
  });

  it('reads a dues payment as a movement alongside ledger entries — the union, not a copy', async () => {
    // This is the test the brief's Step 5 warns might not exist: drop the
    // `payments` half of listMovements and nothing above would fail, because
    // every other test here only ever inserts ledger_entries rows. A real
    // due, paid, is the only way to exercise the union at all.
    const season = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    const personId = await createPerson(db, 'יוסף', LEAD);
    await addMember(db, personId, season.id);
    await issueFlatDues(db, season.id);
    const [row] = await listSeasonFees(db, season.id);

    await recordPayment(db, {
      dueId: row.dueId!, amount: 1500, channel: 'מזומן', paidOn: new Date('2025-07-01T00:00:00Z'),
      recordedBy: LEAD,
    });

    // A ledger entry in the same season, so the totals reflect both sources.
    await recordEntry(db, {
      occurredOn: new Date('2025-07-02T00:00:00Z'), direction: 'out', amount: 300,
      description: 'הוצאה', recordedBy: LEAD, seasonId: season.id,
    });

    const moves = await listMovements(db, { seasonId: season.id });
    expect(moves).toHaveLength(2);
    expect(moves.some((m) => m.source === 'dues')).toBe(true);
    expect(moves.some((m) => m.source === 'ledger')).toBe(true);

    const totals = await ledgerTotals(db, { seasonId: season.id });
    expect(totals.count).toBe(2);
    expect(totals.inAgorot).toBe(150000);
    expect(totals.outAgorot).toBe(30000);
    expect(totals.netAgorot).toBe(120000);
  });

  /**
   * A `קיזוז` settles a due against a debt the camp already owes the payer —
   * no cash changes hands. `unattributedAgorot` already excludes it for the
   * same reason (`accounts.ts`). Counting it here as ledger income would make
   * a season's "in" total exceed every shekel it actually received, by
   * exactly the amount of every offset dues ever get settled with.
   */
  it('excludes a קיזוז offset from ledger income — it moves no cash', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const personId = await createPerson(db, 'יוסף', LEAD);
    await addMember(db, personId, season.id);
    await issueFlatDues(db, season.id);
    const [row] = await listSeasonFees(db, season.id);

    await recordOffset(db, {
      entries: [{ dueId: row.dueId!, amount: 1200 }],
      note: 'קיזוז מול חוב הקאמפ ליוסף',
      paidOn: new Date('2026-07-01T00:00:00Z'),
      recordedBy: LEAD,
    });

    await recordEntry(db, {
      occurredOn: new Date('2026-07-02T00:00:00Z'), direction: 'in', amount: 500,
      description: 'תרומה אמיתית', recordedBy: LEAD, seasonId: season.id,
    });

    const totals = await ledgerTotals(db, { seasonId: season.id });
    expect(totals.count).toBe(1);
    expect(totals.inAgorot).toBe(50000);
  });
});
