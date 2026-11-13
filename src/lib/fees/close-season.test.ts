import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues, setException } from '@/lib/fees/dues';
import { recordPayment, listPayments } from '@/lib/fees/payments';
import { listSeasonFees } from '@/lib/fees/season-fees';
import { createObligation, listObligations } from '@/lib/money/obligations';
import { listMovements } from '@/lib/money/ledger';
import { accountBalances, createAccount } from '@/lib/money/accounts';
import { seasonClosePreview, closeSeasonBalances, closingNote } from './close-season';

const LEAD = 'lead@example.com';
let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });

/** ברן 25 as the lead left it: one paid, one half paid, one unpaid, one
 *  with no due issued, a debt each way, and one debt nobody is named on. */
async function lastYear() {
  const season = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
  const paid = await createPerson(db, 'אופק', LEAD);
  const half = await createPerson(db, 'נטלי', LEAD);
  const unpaid = await createPerson(db, 'יוסף', LEAD);
  const unissued = await createPerson(db, 'עמי', LEAD);
  for (const id of [paid, half, unpaid]) await addMember(db, id, season.id);
  await issueFlatDues(db, season.id);
  await addMember(db, unissued, season.id);

  const rows = await listSeasonFees(db, season.id);
  const dueOf = (personId: string) => rows.find((row) => row.personId === personId)!.dueId!;
  await recordPayment(db, {
    dueId: dueOf(paid), amount: 1500, channel: 'מזומן',
    paidOn: new Date('2025-06-01T00:00:00Z'), recordedBy: LEAD,
  });
  await recordPayment(db, {
    dueId: dueOf(half), amount: 600, channel: 'ביט',
    paidOn: new Date('2025-06-01T00:00:00Z'), recordedBy: LEAD,
  });

  const campOwes = await createObligation(db, {
    direction: 'camp_owes', partyPersonId: unpaid, description: 'החזר על קרח',
    amount: 300, seasonId: season.id, openedOn: null,
  });
  const owedToCamp = await createObligation(db, {
    direction: 'owed_to_camp', partyName: 'רוני אדלר', description: 'הלוואה לגנרטור',
    amount: 1000, seasonId: season.id, openedOn: null,
  });
  const unnamed = await createObligation(db, {
    direction: 'camp_owes', description: 'שולם 500 — מקפיא באיחסון נוסף',
    amount: 500, seasonId: season.id, openedOn: null,
  });
  return { season, paid, half, unpaid, unissued, campOwes, owedToCamp, unnamed };
}

describe('seasonClosePreview', () => {
  it('counts what is open, what was never issued and what cannot be closed', async () => {
    const { season, half, unpaid } = await lastYear();
    const preview = await seasonClosePreview(db, season.id);
    expect(preview.seasonName).toBe('ברן 25');
    expect(preview.dues.count).toBe(2);
    expect(preview.dues.totalAgorot).toBe(90000 + 150000);
    expect(preview.dues.rows.map((row) => row.personId).sort())
      .toEqual([half, unpaid].sort());
    expect(preview.unissued).toBe(1);
    expect(preview.obligations.count).toBe(2);
    expect(preview.obligations.campOwesAgorot).toBe(30000);
    expect(preview.obligations.owedToCampAgorot).toBe(100000);
    expect(preview.unnamed).toBe(1);
  });

  it('refuses a season that does not exist, in Hebrew', async () => {
    await expect(seasonClosePreview(db, '00000000-0000-4000-8000-000000000000'))
      .rejects.toThrow('השנה הזאת לא נמצאה.');
  });
});

describe('closeSeasonBalances', () => {
  it('zeroes every open due and named debt with one note, keeps every row, and moves no cash', async () => {
    const { season, half, unpaid, unnamed } = await lastYear();
    const account = await createAccount(db, { name: 'קופת מזומן', kind: 'cash', openingBalance: 100 });

    const result = await closeSeasonBalances(db, {
      seasonId: season.id, dues: true, obligations: true,
      closedOn: new Date('2026-11-13T00:00:00Z'), recordedBy: LEAD,
    });
    expect(result).toEqual({
      duesClosed: 2, duesAgorot: 240000,
      obligationsClosed: 2, obligationsAgorot: 130000,
      unnamedLeft: 1,
    });

    // Every member reads settled; the half payment is still there beside the
    // write-off, and the write-off says why it exists.
    const rows = await listSeasonFees(db, season.id);
    for (const personId of [half, unpaid]) {
      const row = rows.find((one) => one.personId === personId)!;
      expect(row.outstandingAgorot).toBe(0);
      expect(row.settled).toBe(true);
    }
    const halfPayments = await listPayments(db, rows.find((one) => one.personId === half)!.dueId!);
    expect(halfPayments.map((p) => [p.channel, p.amountAgorot])).toEqual([['ביט', 60000], ['קיזוז', 90000]]);
    expect(halfPayments[1].note).toBe(closingNote('ברן 25'));
    expect(halfPayments[1].accountId).toBeNull();

    // The debts read settled, except the one nobody is named on.
    const debts = await listObligations(db, { seasonId: season.id });
    expect(debts.filter((row) => row.settled).length).toBe(2);
    expect(debts.find((row) => row.id === unnamed)!.settled).toBe(false);
    expect(debts.find((row) => row.settled)!.settlements[0].note).toBe(closingNote('ברן 25'));

    // No cash moved: the ledger holds only the two real payments from the
    // fixture, no קיזוז joins them, and the קופה is where it was.
    expect((await listMovements(db)).map((move) => move.amountAgorot).sort((a, b) => a - b))
      .toEqual([60000, 150000]);
    const [balance] = (await accountBalances(db)).filter((row) => row.accountId === account.id);
    expect(balance.balanceAgorot).toBe(10000);
  });

  it('closes only what was chosen', async () => {
    const { season } = await lastYear();
    const result = await closeSeasonBalances(db, {
      seasonId: season.id, dues: true, obligations: false,
      closedOn: new Date('2026-11-13T00:00:00Z'), recordedBy: LEAD,
    });
    expect(result.duesClosed).toBe(2);
    expect(result.obligationsClosed).toBe(0);
    expect(result.unnamedLeft).toBe(0);
    const preview = await seasonClosePreview(db, season.id);
    expect(preview.dues.count).toBe(0);
    expect(preview.obligations.count).toBe(2);
  });

  it('leaves an exception of zero alone and does not write a zero offset', async () => {
    const { season, unpaid } = await lastYear();
    await setException(db, {
      personId: unpaid, seasonId: season.id, amount: 0, reason: 'עבד את כל הבנייה', decidedBy: LEAD,
    });
    const result = await closeSeasonBalances(db, {
      seasonId: season.id, dues: true, obligations: false,
      closedOn: new Date('2026-11-13T00:00:00Z'), recordedBy: LEAD,
    });
    expect(result.duesClosed).toBe(1);
    const row = (await listSeasonFees(db, season.id)).find((one) => one.personId === unpaid)!;
    expect(row.payments).toHaveLength(0);
  });

  it('is a no-op the second time, and says so rather than reporting success', async () => {
    const { season } = await lastYear();
    await closeSeasonBalances(db, {
      seasonId: season.id, dues: true, obligations: true,
      closedOn: new Date('2026-11-13T00:00:00Z'), recordedBy: LEAD,
    });
    await expect(closeSeasonBalances(db, {
      seasonId: season.id, dues: true, obligations: true,
      closedOn: new Date('2026-11-13T00:00:00Z'), recordedBy: LEAD,
    })).rejects.toThrow('אין יתרות פתוחות לסגור בברן 25.');
  });

  it('refuses a close that chooses nothing', async () => {
    const { season } = await lastYear();
    await expect(closeSeasonBalances(db, {
      seasonId: season.id, dues: false, obligations: false,
      closedOn: new Date('2026-11-13T00:00:00Z'), recordedBy: LEAD,
    })).rejects.toThrow('בחרו מה לסגור: חיובים, חובות, או שניהם.');
  });
});
