import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { ledgerEntries } from '@/db/schema/money';
import { payments } from '@/db/schema/camp';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues } from '@/lib/fees/dues';
import { recordOffset } from '@/lib/fees/payments';
import { listSeasonFees } from '@/lib/fees/season-fees';
import { accountBalances, createAccount } from './accounts';
import { fundBalances, fundKeyOf, fundSeasonFlows } from './funds';
import { seasonMoneySummary } from './summary';

let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });

describe('fundBalances', () => {
  it("sums each pot's accounts apart, and never one into the other", () => {
    const totals = fundBalances([
      { fund: 'gift', balanceAgorot: 1904200 },
      { fund: 'camp', balanceAgorot: -1341200 },
      { fund: 'camp', balanceAgorot: 0 },
    ]);
    // The camp is overdrawn and the gift is not. One figure over both would
    // read 5,630 and say neither.
    expect(totals.camp).toEqual({ balanceAgorot: -1341200, accountCount: 2 });
    expect(totals.gift).toEqual({ balanceAgorot: 1904200, accountCount: 1 });
    expect(totals.unassigned).toEqual({ balanceAgorot: 0, accountCount: 0 });
  });

  it('counts an account nobody has placed in neither pot', () => {
    const totals = fundBalances([
      { fund: 'camp', balanceAgorot: 100000 },
      { fund: null, balanceAgorot: 412000 },
    ]);
    expect(totals.camp.balanceAgorot).toBe(100000);
    expect(totals.gift.balanceAgorot).toBe(0);
    expect(totals.unassigned).toEqual({ balanceAgorot: 412000, accountCount: 1 });
  });

  it('files a stored value that is neither pot under unassigned, never drops it', () => {
    expect(fundKeyOf('dancefloor' as never)).toBe('unassigned');
    expect(fundBalances([{ fund: 'dancefloor' as never, balanceAgorot: 5 }]).unassigned)
      .toEqual({ balanceAgorot: 5, accountCount: 1 });
  });

  it("agrees with the cards: a pot's figure is the sum of its accounts' derived balances", async () => {
    const ofek = await createAccount(db, { name: 'עו״ש אופק', kind: 'personal', fund: 'camp' });
    await createAccount(db, {
      name: 'וייבז קלוז פרינדס', kind: 'event_float', fund: 'gift', openingBalance: 19042,
      openingOn: new Date('2026-09-27T00:00:00Z'),
    });
    await db.insert(ledgerEntries).values({
      occurredOn: new Date('2026-11-02T00:00:00Z'), direction: 'out', amount: '13570.00',
      description: 'צילייה', accountId: ofek.id, recordedBy: 'lead',
    });

    const totals = fundBalances(await accountBalances(db));
    expect(totals.camp.balanceAgorot).toBe(-1357000);
    expect(totals.gift.balanceAgorot).toBe(1904200);
  });
});

describe('fundSeasonFlows', () => {
  async function seed() {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const other = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    const camp = await createAccount(db, { name: 'עו״ש אופק', kind: 'personal', fund: 'camp' });
    const gift = await createAccount(db, { name: 'וייבז קלוז פרינדס', kind: 'event_float', fund: 'gift' });
    const old = await createAccount(db, { name: 'קופה ישנה', kind: 'cash' });
    return { season, other, camp, gift, old };
  }

  it('files a movement under the pot of the account it names', async () => {
    const { season, camp, gift } = await seed();
    await db.insert(ledgerEntries).values([
      { occurredOn: new Date('2026-07-18T00:00:00Z'), direction: 'in', amount: '57000.00',
        description: 'רווח מסיבת פקאנים', accountId: gift.id, seasonId: season.id, recordedBy: 'lead' },
      { occurredOn: new Date('2026-07-22T00:00:00Z'), direction: 'out', amount: '8820.00',
        description: 'כרטיסי אומנים', accountId: gift.id, seasonId: season.id, recordedBy: 'lead' },
      { occurredOn: new Date('2026-11-02T00:00:00Z'), direction: 'out', amount: '10580.00',
        description: 'פאוור און', accountId: camp.id, seasonId: season.id, recordedBy: 'lead' },
    ]);

    const flows = await fundSeasonFlows(db, season.id);
    expect(flows.gift).toEqual({ inAgorot: 5700000, outAgorot: 882000 });
    expect(flows.camp).toEqual({ inAgorot: 0, outAgorot: 1058000 });
    expect(flows.unassigned).toEqual({ inAgorot: 0, outAgorot: 0 });
  });

  it('counts dues as money into the pot of the account they were paid into', async () => {
    const { season, camp } = await seed();
    const personId = await createPerson(db, 'יוסף', 'lead@example.com');
    await addMember(db, personId, season.id);
    await issueFlatDues(db, season.id);
    const [fee] = await listSeasonFees(db, season.id);
    await db.insert(payments).values({
      dueId: fee.dueId!, amount: '1200.00', channel: 'ביט',
      paidOn: new Date('2026-10-05T00:00:00Z'), accountId: camp.id, recordedBy: 'lead',
    });

    const flows = await fundSeasonFlows(db, season.id);
    expect(flows.camp).toEqual({ inAgorot: 120000, outAgorot: 0 });
    expect(flows.gift).toEqual({ inAgorot: 0, outAgorot: 0 });
  });

  /* A קיזוז moves no cash and carries no account, so it is in no pot's flow —
     the join leaves it out, and this pins that it does. */
  it('leaves an offset out of every pot: it moved no cash', async () => {
    const { season } = await seed();
    const personId = await createPerson(db, 'יוסף', 'lead@example.com');
    await addMember(db, personId, season.id);
    await issueFlatDues(db, season.id);
    const [fee] = await listSeasonFees(db, season.id);
    await recordOffset(db, {
      entries: [{ dueId: fee.dueId!, amount: 1200 }],
      note: 'מול חוב יוסף', paidOn: new Date('2026-10-05T00:00:00Z'), recordedBy: 'lead',
    });

    const flows = await fundSeasonFlows(db, season.id);
    expect(flows.camp.inAgorot + flows.gift.inAgorot + flows.unassigned.inAgorot).toBe(0);
  });

  it('keeps the season scope, and files an unplaced account under unassigned', async () => {
    const { season, other, camp, old } = await seed();
    await db.insert(ledgerEntries).values([
      { occurredOn: new Date('2025-08-01T00:00:00Z'), direction: 'out', amount: '8850.00',
        description: 'מכולה', accountId: camp.id, seasonId: other.id, recordedBy: 'lead' },
      { occurredOn: new Date('2026-08-01T00:00:00Z'), direction: 'out', amount: '231.00',
        description: 'ציוד מכולה', accountId: old.id, seasonId: season.id, recordedBy: 'lead' },
      // No account at all: in no pot. It is the unattributed banner's.
      { occurredOn: new Date('2026-08-01T00:00:00Z'), direction: 'out', amount: '400.00',
        description: 'בלי חשבון', seasonId: season.id, recordedBy: 'lead' },
    ]);

    const flows = await fundSeasonFlows(db, season.id);
    expect(flows.camp).toEqual({ inAgorot: 0, outAgorot: 0 });
    expect(flows.unassigned).toEqual({ inAgorot: 0, outAgorot: 23100 });
    expect((await fundSeasonFlows(db, other.id)).camp).toEqual({ inAgorot: 0, outAgorot: 885000 });
  });

  /* The camp's own reading of its books: what an uncounted camp account
     holds is the dues paid into it minus the camp's expenses. */
  it("makes an uncounted camp account's balance its dues minus its expenses", async () => {
    const { season, camp } = await seed();
    const personId = await createPerson(db, 'יוסף', 'lead@example.com');
    await addMember(db, personId, season.id);
    await issueFlatDues(db, season.id);
    const [fee] = await listSeasonFees(db, season.id);
    await db.insert(payments).values({
      dueId: fee.dueId!, amount: '1200.00', channel: 'ביט',
      paidOn: new Date('2026-10-05T00:00:00Z'), accountId: camp.id, recordedBy: 'lead',
    });
    await db.insert(ledgerEntries).values({
      occurredOn: new Date('2026-11-02T00:00:00Z'), direction: 'out', amount: '2124.00',
      description: 'מקלחות', accountId: camp.id, seasonId: season.id, recordedBy: 'lead',
    });

    const summary = await seasonMoneySummary(db, season.id);
    expect(summary.fundFlows.camp).toEqual({ inAgorot: 120000, outAgorot: 212400 });
    expect(summary.funds.camp).toEqual({ balanceAgorot: -92400, accountCount: 1 });
    expect(summary.funds.camp.balanceAgorot)
      .toBe(summary.fundFlows.camp.inAgorot - summary.fundFlows.camp.outAgorot);
  });
});
