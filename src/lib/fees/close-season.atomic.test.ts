import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues } from '@/lib/fees/dues';
import { listPayments } from '@/lib/fees/payments';
import { listSeasonFees } from '@/lib/fees/season-fees';

/*
 * The close is one transaction. This file makes the debt half fail — the
 * real `settleObligation` replaced by one that throws — and asks what is
 * left of the dues half that ran before it. Its own file because the mock
 * is module-wide, and `close-season.test.ts` needs the real function.
 */
const { settle } = vi.hoisted(() => ({ settle: vi.fn() }));
vi.mock('@/lib/money/obligations', async (original) => ({
  ...(await original<typeof import('@/lib/money/obligations')>()),
  settleObligation: settle,
}));

import { createObligation } from '@/lib/money/obligations';
import { seasonClosePreview, closeSeasonBalances } from './close-season';

const LEAD = 'lead@example.com';
let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
  settle.mockReset();
  settle.mockRejectedValue(new Error('the second half failed'));
});

describe('closeSeasonBalances, when a debt fails after the dues were written', () => {
  it('writes nothing: the dues are still open and carry no write-off', async () => {
    const season = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    const yosef = await createPerson(db, 'יוסף', LEAD);
    await addMember(db, yosef, season.id);
    await issueFlatDues(db, season.id);
    await createObligation(db, {
      direction: 'owed_to_camp', partyName: 'רוני אדלר', description: 'הלוואה לגנרטור',
      amount: 1000, seasonId: season.id, openedOn: null,
    });
    const [fee] = await listSeasonFees(db, season.id);

    await expect(closeSeasonBalances(db, {
      seasonId: season.id, dues: true, obligations: true,
      closedOn: new Date('2026-11-14T10:00:00Z'), recordedBy: LEAD,
    })).rejects.toThrow('the second half failed');

    // The debt half was reached, so the dues half had already run.
    expect(settle).toHaveBeenCalledTimes(1);
    expect(await listPayments(db, fee.dueId!)).toEqual([]);
    const after = await seasonClosePreview(db, season.id);
    expect(after.dues.count).toBe(1);
    expect(after.dues.totalAgorot).toBe(150000);
    expect(after.obligations.count).toBe(1);
  });
});
