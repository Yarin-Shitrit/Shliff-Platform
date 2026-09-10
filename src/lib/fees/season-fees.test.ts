import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues, setException } from '@/lib/fees/dues';
import { recordPayment } from '@/lib/fees/payments';
import { listSeasonFees } from '@/lib/fees/season-fees';

const LEAD = 'lead@shliff.camp';
const WHEN = new Date('2026-07-01T00:00:00Z');

describe('listSeasonFees', () => {
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

  it('shows a roster member with no due as a row, not a warning', async () => {
    await member('עמירם דהן');
    // No issueFlatDues — this member has never been billed.

    const rows = await listSeasonFees(db, seasonId);
    expect(rows).toHaveLength(1);
    expect(rows[0].dueId).toBeNull();
    expect(rows[0].amountAgorot).toBeNull();
    expect(rows[0].settled).toBe(false);
    expect(rows[0].paidAgorot).toBe(0);
    expect(rows[0].outstandingAgorot).toBe(0);
    expect(rows[0].payments).toEqual([]);
  });

  it('shows the full amount outstanding for a due with no payment', async () => {
    await member('אופק');
    await issueFlatDues(db, seasonId);

    const [row] = await listSeasonFees(db, seasonId);
    expect(row.dueId).not.toBeNull();
    expect(row.amountAgorot).toBe(120000);
    expect(row.paidAgorot).toBe(0);
    expect(row.outstandingAgorot).toBe(120000);
    expect(row.settled).toBe(false);
  });

  it('shows both instalments and zero outstanding for a member paid in two goes', async () => {
    await member('יוסף');
    await issueFlatDues(db, seasonId);
    const [row] = await listSeasonFees(db, seasonId);
    await recordPayment(db, {
      dueId: row.dueId!, amount: 700, channel: 'ביט', paidOn: WHEN, recordedBy: LEAD,
    });
    await recordPayment(db, {
      dueId: row.dueId!, amount: 500, channel: 'מזומן', paidOn: WHEN, recordedBy: LEAD,
    });

    const [after] = await listSeasonFees(db, seasonId);
    expect(after.payments).toHaveLength(2);
    expect(after.paidAgorot).toBe(120000);
    expect(after.outstandingAgorot).toBe(0);
    expect(after.settled).toBe(true);
  });

  it('treats a zero-amount exception as settled with no payments', async () => {
    const amiram = await member('עמירם דהן');
    await issueFlatDues(db, seasonId);
    await setException(db, {
      personId: amiram, seasonId, amount: 0,
      reason: 'פטור מלא — הוביל את ההקמה', decidedBy: LEAD,
    });

    const [row] = await listSeasonFees(db, seasonId);
    expect(row.amountAgorot).toBe(0);
    expect(row.kind).toBe('exception');
    expect(row.settled).toBe(true);
    expect(row.payments).toEqual([]);
  });

  it('sorts rows by display name', async () => {
    await member('תומר גולן');
    await member('איתן');
    await member('דנה שרון');

    const rows = await listSeasonFees(db, seasonId);
    expect(rows.map((r) => r.displayName)).toEqual(['איתן', 'דנה שרון', 'תומר גולן']);
  });

  it('never shows a person from another season, even with a due there', async () => {
    const otherSeason = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    const elsewhere = await createPerson(db, 'מישהו אחר', LEAD);
    await addMember(db, elsewhere, otherSeason.id);
    await issueFlatDues(db, otherSeason.id);

    await member('אופק');

    const rows = await listSeasonFees(db, seasonId);
    expect(rows.map((r) => r.displayName)).toEqual(['אופק']);
  });
});
