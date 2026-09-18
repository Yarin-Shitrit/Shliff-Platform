import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { ledgerEntries } from '@/db/schema/money';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues } from '@/lib/fees/dues';
import { recordOffset } from '@/lib/fees/payments';
import { listSeasonFees } from '@/lib/fees/season-fees';
import { createAccount, listAccounts, accountBalances, unattributedAgorot } from './accounts';

let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });

describe('accounts', () => {
  it('derives a balance from opening plus in minus out', async () => {
    const account = await createAccount(db, { name: 'קופת מזומן', kind: 'cash', openingBalance: 1000 });
    await db.insert(ledgerEntries).values([
      { occurredOn: new Date(), direction: 'in', amount: '750.50',
        description: 'הכנסה', accountId: account.id, recordedBy: 'lead' },
      { occurredOn: new Date(), direction: 'out', amount: '166.50',
        description: 'הוצאה', accountId: account.id, recordedBy: 'lead' },
    ]);

    const [balance] = await accountBalances(db);
    expect(balance.balanceAgorot).toBe(158400);
  });

  it('names the person holding a personal account', async () => {
    const db2 = await createTestDb();
    const personId = await createPerson(db2, 'אופק', 'lead@example.com');
    await createAccount(db2, {
      name: 'עו״ש אופק', kind: 'personal', holderPersonId: personId, openingBalance: 14079.55,
    });

    const [balance] = await accountBalances(db2);
    expect(balance.kind).toBe('personal');
    expect(balance.holderName).toBe('אופק');
    expect(balance.balanceAgorot).toBe(1407955);
  });

  it('refuses a blank account name', async () => {
    await expect(createAccount(db, { name: '  ‏ ', kind: 'cash' }))
      .rejects.toThrow(/שם/);
  });

  it('lists a closed account but keeps it out of nothing', async () => {
    const a = await createAccount(db, { name: 'וייבז', kind: 'event_float', closedAt: new Date() });
    expect((await listAccounts(db)).map((row) => row.id)).toContain(a.id);
  });

  it('reports an unattributed inflow and an unattributed outflow separately, not summed', async () => {
    // The defect this pins: summing both directions turned "money in" and
    // "money out" into one number that is a quantity of nothing.
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    await db.insert(ledgerEntries).values([
      { occurredOn: new Date(), direction: 'in', amount: '500.00',
        description: 'הכנסה בלי חשבון', seasonId: season.id, recordedBy: 'lead' },
      { occurredOn: new Date(), direction: 'out', amount: '300.00',
        description: 'הוצאה בלי חשבון', seasonId: season.id, recordedBy: 'lead' },
    ]);

    const result = await unattributedAgorot(db, season.id);
    expect(result.inAgorot).toBe(50000);
    expect(result.outAgorot).toBe(30000);
  });

  it("excludes another season's unattributed movements from this season's figure", async () => {
    const other = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    await db.insert(ledgerEntries).values({
      occurredOn: new Date(), direction: 'in', amount: '900.00',
      description: 'שייך לעונה אחרת', seasonId: other.id, recordedBy: 'lead',
    });

    const result = await unattributedAgorot(db, season.id);
    expect(result.inAgorot).toBe(0);
  });

  it('does not count a ledger movement that names an account as unattributed', async () => {
    const account = await createAccount(db, { name: 'קופה', kind: 'cash' });
    await db.insert(ledgerEntries).values({
      occurredOn: new Date(), direction: 'in', amount: '500.00',
      description: 'עם חשבון', accountId: account.id, recordedBy: 'lead',
    });

    const result = await unattributedAgorot(db);
    expect(result.inAgorot).toBe(0);
  });

  it('excludes a real offset payment from unattributed money, though it names no account', async () => {
    // The vacuous version of this check (an empty db reporting zero) cannot
    // tell a working exclusion from a deleted one — both report zero when
    // there is no payment to mis-count. This one actually creates a קיזוז
    // payment (accountId null by construction) and proves it stays excluded.
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const personId = await createPerson(db, 'יוסף', 'lead@example.com');
    await addMember(db, personId, season.id);
    await issueFlatDues(db, season.id);
    const [row] = await listSeasonFees(db, season.id);

    await recordOffset(db, {
      entries: [{ dueId: row.dueId!, amount: 1200 }],
      note: 'קיזוז מול חוב הקאמפ ליוסף',
      paidOn: new Date(),
      recordedBy: 'lead',
    });

    const { paymentsAgorot } = await unattributedAgorot(db);
    expect(paymentsAgorot).toBe(0);
  });
});
