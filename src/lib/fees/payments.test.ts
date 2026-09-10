import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues, listDues, setException } from '@/lib/fees/dues';
import {
  recordPayment, recordOffset, listPayments, deletePayment, settlementFor,
} from '@/lib/fees/payments';

const LEAD = 'lead@shliff.camp';
const WHEN = new Date('2026-07-01T00:00:00Z');

describe('payments', () => {
  let db: TestDb;
  let seasonId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    seasonId = season.id;
  });

  async function dueFor(name: string) {
    const personId = await createPerson(db, name, LEAD);
    await addMember(db, personId, seasonId);
    await issueFlatDues(db, seasonId);
    const row = (await listDues(db, seasonId)).find((d) => d.personId === personId)!;
    return { personId, dueId: row.dueId };
  }

  it('records a cash payment and leaves the rest outstanding', async () => {
    const { dueId } = await dueFor('אופק');
    await recordPayment(db, {
      dueId, amount: 500, channel: 'מזומן', paidOn: WHEN, recordedBy: LEAD,
    });

    const settlement = await settlementFor(db, dueId);
    expect(settlement.dueAgorot).toBe(120000);
    expect(settlement.paidAgorot).toBe(50000);
    expect(settlement.outstandingAgorot).toBe(70000);
    expect(settlement.settled).toBe(false);
  });

  it('settles a due paid in two goes through different channels', async () => {
    const { dueId } = await dueFor('אופק');
    await recordPayment(db, {
      dueId, amount: 700, channel: 'ביט', paidOn: WHEN, recordedBy: LEAD,
    });
    await recordPayment(db, {
      dueId, amount: 500, channel: 'מזומן', paidOn: WHEN, recordedBy: LEAD,
    });

    const settlement = await settlementFor(db, dueId);
    expect(settlement.paidAgorot).toBe(120000);
    expect(settlement.outstandingAgorot).toBe(0);
    expect(settlement.settled).toBe(true);
    expect(settlement.overpaid).toBe(false);
    expect(await listPayments(db, dueId)).toHaveLength(2);
  });

  it('flags an overpayment rather than refusing it', async () => {
    const { dueId } = await dueFor('אופק');
    await recordPayment(db, {
      dueId, amount: 1500, channel: 'העברה', paidOn: WHEN, recordedBy: LEAD,
    });

    const settlement = await settlementFor(db, dueId);
    expect(settlement.overpaid).toBe(true);
    expect(settlement.outstandingAgorot).toBe(0);
  });

  it('treats a zero due as settled with no payments', async () => {
    const { personId, dueId } = await dueFor('עמירם דהן');
    await setException(db, {
      personId, seasonId, amount: 0, reason: 'פטור מלא', decidedBy: LEAD,
    });

    const settlement = await settlementFor(db, dueId);
    expect(settlement.settled).toBe(true);
    expect(settlement.paidAgorot).toBe(0);
  });

  it('refuses an offset with no note saying what it was set against', async () => {
    const { dueId } = await dueFor('יוסף');
    await expect(recordPayment(db, {
      dueId, amount: 1200, channel: 'קיזוז', paidOn: WHEN, recordedBy: LEAD,
    })).rejects.toThrow(/note/);
  });

  /**
   * Same hole as the exception reason in Task 5: `.trim()` does not strip
   * directional or zero-width marks, which an RTL browser injects invisibly.
   * It matters more here — the note is the only thing tying an offset back to
   * the debt it settled, which is precisely the link the source workbook lost.
   */
  it('refuses an offset note that is only invisible directional marks', async () => {
    const { dueId } = await dueFor('יוסף');
    await expect(recordPayment(db, {
      dueId, amount: 1200, channel: 'קיזוז', paidOn: WHEN,
      note: '\u200e\u200f\u200b', recordedBy: LEAD,
    })).rejects.toThrow(/note/);
  });

  it('refuses an unknown channel', async () => {
    const { dueId } = await dueFor('אופק');
    await expect(recordPayment(db, {
      dueId, amount: 100, channel: 'ביטקוין' as never,
      paidOn: WHEN, recordedBy: LEAD,
    })).rejects.toThrow(/channel/);
  });

  it('refuses a non-positive payment', async () => {
    const { dueId } = await dueFor('אופק');
    await expect(recordPayment(db, {
      dueId, amount: 0, channel: 'מזומן', paidOn: WHEN, recordedBy: LEAD,
    })).rejects.toThrow(/positive/);
  });

  it('settles five dues from one 6,000 offset, sharing one note', async () => {
    const names = ['יוסף', 'קארינה', 'יונתן', 'ירין', 'עילאי'];
    const entries = [];
    for (const name of names) {
      const { dueId } = await dueFor(name);
      entries.push({ dueId, amount: 1200 });
    }

    const ids = await recordOffset(db, {
      entries,
      note: 'קיזוז מול חוב יוסף — 6,000',
      paidOn: WHEN,
      recordedBy: LEAD,
    });
    expect(ids).toHaveLength(5);

    for (const { dueId } of entries) {
      const settlement = await settlementFor(db, dueId);
      expect(settlement.settled).toBe(true);
      const [payment] = await listPayments(db, dueId);
      expect(payment.channel).toBe('קיזוז');
      expect(payment.note).toBe('קיזוז מול חוב יוסף — 6,000');
    }
  });

  it('deletes a payment and reopens the due', async () => {
    const { dueId } = await dueFor('אופק');
    const id = await recordPayment(db, {
      dueId, amount: 1200, channel: 'מזומן', paidOn: WHEN, recordedBy: LEAD,
    });
    expect((await settlementFor(db, dueId)).settled).toBe(true);

    await deletePayment(db, id);
    expect((await settlementFor(db, dueId)).settled).toBe(false);
  });
});
