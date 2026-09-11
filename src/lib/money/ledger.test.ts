import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues } from '@/lib/fees/dues';
import { recordPayment } from '@/lib/fees/payments';
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

  it('writes a transfer as two entries sharing a group', async () => {
    const from = await createAccount(db, { name: 'וייבז', kind: 'event_float', openingBalance: 5000 });
    const to = await createAccount(db, { name: 'קופת מזומן', kind: 'cash' });

    await recordTransfer(db, {
      fromAccountId: from.id, toAccountId: to.id, amount: 1200,
      occurredOn: new Date(), description: 'העברה לקופה', recordedBy: LEAD,
    });

    const moves = await listMovements(db);
    expect(moves).toHaveLength(2);
    expect(new Set(moves.map((m) => m.direction))).toEqual(new Set(['in', 'out']));
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
});
