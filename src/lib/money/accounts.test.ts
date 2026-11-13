import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { ledgerEntries } from '@/db/schema/money';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues } from '@/lib/fees/dues';
import { recordOffset } from '@/lib/fees/payments';
import { listSeasonFees } from '@/lib/fees/season-fees';
import { payments } from '@/db/schema/camp';
import {
  createAccount, listAccounts, listOpenAccounts, accountBalances, unattributedAgorot,
  countAccount,
} from './accounts';

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

  /**
   * The ברן 25 מיקום figures are the sheet's closing line: they already hold
   * every movement up to 2025-10-30. Attributing one of those movements
   * files it under its קופה and must leave the figure where it was — the
   * money left once. A movement after the count is new to it and moves it.
   */
  it('leaves a counted balance alone for a movement on or before the count day, and moves it for one after', async () => {
    const account = await createAccount(db, {
      name: 'עו״ש אופק', kind: 'personal', openingBalance: 14079.55,
      openingOn: new Date('2025-10-30T00:00:00Z'),
    });
    await db.insert(ledgerEntries).values([
      { occurredOn: new Date('2025-10-16T00:00:00Z'), direction: 'out', amount: '20660.00',
        description: 'חצי שני למייצג נטלי', accountId: account.id, recordedBy: 'lead' },
      // The count day itself, stored at Israel midnight — 22:00Z the evening
      // before in UTC (winter time). Still the count day in the camp's calendar.
      { occurredOn: new Date('2025-10-29T22:00:00Z'), direction: 'in', amount: '15660.00',
        description: 'מסיבת האלווין 30/10', accountId: account.id, recordedBy: 'lead' },
      { occurredOn: new Date('2026-06-01T00:00:00Z'), direction: 'out', amount: '14000.00',
        description: 'חוב לירון סלע על ברן 25', accountId: account.id, recordedBy: 'lead' },
    ]);

    const [balance] = await accountBalances(db);
    expect(balance.countedOn?.toISOString()).toBe('2025-10-30T00:00:00.000Z');
    expect(balance.countedAgorot).toBe(1407955);
    expect(balance.balanceAgorot).toBe(1407955 - 1400000);
  });

  it('counts every movement when the balance has no count day', async () => {
    const account = await createAccount(db, { name: 'קופת מזומן', kind: 'cash', openingBalance: 0 });
    await db.insert(ledgerEntries).values([
      { occurredOn: new Date('2025-06-10T00:00:00Z'), direction: 'out', amount: '200.00',
        description: 'תרומה אבישי פרץ', accountId: account.id, recordedBy: 'lead' },
    ]);
    const [balance] = await accountBalances(db);
    expect(balance.countedOn).toBeNull();
    expect(balance.balanceAgorot).toBe(-20000);
  });

  it('refuses a count day in the future on a new account', async () => {
    const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await expect(createAccount(db, {
      name: 'קופה', kind: 'cash', openingBalance: 5, openingOn: tomorrow,
    })).rejects.toThrow('תאריך הספירה לא יכול להיות בעתיד.');
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

describe('listOpenAccounts', () => {
  it('offers every account that has not been closed, in name order', async () => {
    await createAccount(db, { name: 'קופת מזומן', kind: 'cash' });
    await createAccount(db, { name: 'בנק הפועלים', kind: 'bank' });
    await createAccount(db, {
      name: 'עו״ש אופק', kind: 'personal', closedAt: new Date('2025-10-01T00:00:00Z'),
    });

    const open = await listOpenAccounts(db);
    expect(open.map((account) => account.name)).toEqual(['בנק הפועלים', 'קופת מזומן']);
  });

  it('returns nothing when the camp has no accounts yet', async () => {
    expect(await listOpenAccounts(db)).toEqual([]);
  });
});

describe('countAccount', () => {
  /**
   * The way in when the book was not kept: the lead counts what there is
   * and says when. The figure becomes the count; a movement before the day
   * stays recorded and stops moving it; a movement after keeps moving it.
   */
  it('sets the balance as of the day, and reports what the figure absorbs and what it rests on', async () => {
    const account = await createAccount(db, { name: 'קופת מזומן', kind: 'cash', openingBalance: 0 });
    await db.insert(ledgerEntries).values([
      { occurredOn: new Date('2026-03-01T00:00:00Z'), direction: 'out', amount: '400.00',
        description: 'הוצאה ישנה שכן ידועה', accountId: account.id, recordedBy: 'lead' },
      { occurredOn: new Date('2026-09-20T00:00:00Z'), direction: 'in', amount: '250.00',
        description: 'הכנסה אחרי הספירה', accountId: account.id, recordedBy: 'lead' },
    ]);
    // A dues payment is a movement too, and `payments.account_id` is a bare uuid.
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const personId = await createPerson(db, 'יוסף', 'lead@example.com');
    await addMember(db, personId, season.id);
    await issueFlatDues(db, season.id);
    const [fee] = await listSeasonFees(db, season.id);
    await db.insert(payments).values({
      dueId: fee.dueId!, amount: '1200.00', channel: 'מזומן',
      paidOn: new Date('2026-09-25T00:00:00Z'), accountId: account.id, recordedBy: 'lead',
    });

    const result = await countAccount(db, {
      accountId: account.id, balance: 3000, countedOn: new Date('2026-09-01T00:00:00Z'),
    });
    expect(result).toEqual({ insideCount: 1, afterCount: 2 });

    const [balance] = await accountBalances(db);
    expect(balance.countedAgorot).toBe(300000);
    expect(balance.countedOn?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    // 3,000 counted, plus the 250 and the 1,200 that came after; the 400
    // from before is history the count already holds.
    expect(balance.balanceAgorot).toBe(300000 + 25000 + 120000);
  });

  it('replaces an earlier count rather than adding to it', async () => {
    const account = await createAccount(db, {
      name: 'קופת מזומן', kind: 'cash', openingBalance: 1584,
      openingOn: new Date('2025-10-30T00:00:00Z'),
    });
    await countAccount(db, {
      accountId: account.id, balance: 19042, countedOn: new Date('2026-09-27T00:00:00Z'),
    });
    const [balance] = await accountBalances(db);
    expect(balance.balanceAgorot).toBe(1904200);
    expect(balance.countedOn?.toISOString()).toBe('2026-09-27T00:00:00.000Z');
  });

  it('refuses a day in the future, a closed account and a missing one, each in Hebrew', async () => {
    const open = await createAccount(db, { name: 'קופת מזומן', kind: 'cash' });
    const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await expect(countAccount(db, { accountId: open.id, balance: 1, countedOn: tomorrow }))
      .rejects.toThrow('תאריך הספירה לא יכול להיות בעתיד.');

    const closed = await createAccount(db, {
      name: 'וייבז', kind: 'event_float', closedAt: new Date('2025-10-01T00:00:00Z'),
    });
    await expect(countAccount(db, {
      accountId: closed.id, balance: 1, countedOn: new Date('2025-09-01T00:00:00Z'),
    })).rejects.toThrow('החשבון הזה נסגר, ואי אפשר לספור אותו.');

    await expect(countAccount(db, {
      accountId: '00000000-0000-4000-8000-000000000000', balance: 1,
      countedOn: new Date('2025-09-01T00:00:00Z'),
    })).rejects.toThrow('אין חשבון כזה.');

    // Nothing was written by any of the three.
    const [balance] = (await accountBalances(db)).filter((row) => row.accountId === open.id);
    expect(balance.countedOn).toBeNull();
    expect(balance.balanceAgorot).toBe(0);
  });
});
