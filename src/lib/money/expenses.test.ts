import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { accounts, ledgerEntries } from '@/db/schema/money';
import { accountBalances, createAccount } from './accounts';
import { recordEntry, recordTransfer } from './ledger';
import { listLedgerRows } from './ledger-view';
import { createObligation, settleObligation } from './obligations';
import {
  EXPENSE_REFUSALS, deleteOwnExpense, listOwnExpenses, receiptOf, recordExpense,
} from './expenses';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, isExpenseCategory } from './expense-categories';

let db: TestDb;
let seasonId: string;
let otherSeasonId: string;
let accountId: string;

const BUYER = 'buyer@example.com';
const LEAD = 'lead@example.com';
const KEY = 'receipts/0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a.jpg';

beforeEach(async () => {
  db = await createTestDb();
  seasonId = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 })).id;
  otherSeasonId = (await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1100 })).id;
  accountId = (await createAccount(db, { name: 'קופת מזומן', kind: 'cash', fund: 'camp' })).id;
});

function expense(over: Partial<Parameters<typeof recordExpense>[1]> = {}) {
  return {
    occurredOn: new Date('2026-11-18T00:00:00Z'),
    amount: 184.5,
    description: 'קרח ומים',
    accountId,
    seasonId,
    recordedBy: BUYER,
    ...over,
  };
}

describe('the category list', () => {
  it('has a Hebrew word for every category, and knows its own members', () => {
    for (const category of EXPENSE_CATEGORIES) {
      expect(EXPENSE_CATEGORY_LABELS[category]).toMatch(/[א-ת]/);
      expect(isExpenseCategory(category)).toBe(true);
    }
    expect(new Set(Object.values(EXPENSE_CATEGORY_LABELS)).size).toBe(EXPENSE_CATEGORIES.length);
    expect(isExpenseCategory('snacks')).toBe(false);
    expect(isExpenseCategory('')).toBe(false);
    expect(isExpenseCategory(undefined)).toBe(false);
  });
});

describe('recording an expense', () => {
  it('writes one out movement in the ledger, with its category and receipt', async () => {
    const id = await recordExpense(db, expense({ category: 'food', receiptKey: KEY }));
    const [row] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, id));
    expect(row).toMatchObject({
      direction: 'out', amount: '184.50', description: 'קרח ומים', accountId, seasonId,
      expenseCategory: 'food', receiptKey: KEY, recordedBy: BUYER,
      sourceBlockId: null, transferGroupId: null, eventId: null,
    });
    expect(await db.select().from(ledgerEntries)).toHaveLength(1);
  });

  it('moves the balance of the account that paid, and of no other', async () => {
    const other = (await createAccount(db, { name: 'עו״ש אופק', kind: 'personal', fund: 'camp' })).id;
    await recordExpense(db, expense({ amount: 200 }));
    const balances = await accountBalances(db);
    expect(balances.find((one) => one.accountId === accountId)!.balanceAgorot).toBe(-20000);
    expect(balances.find((one) => one.accountId === other)!.balanceAgorot).toBe(0);
  });

  it('leaves the category and the receipt empty when none was given, rather than filing it under אחר', async () => {
    const id = await recordExpense(db, expense());
    const [row] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, id));
    expect(row.expenseCategory).toBeNull();
    expect(row.receiptKey).toBeNull();
  });

  it('shows on the ledger with its category and a receipt flag, and never the storage key', async () => {
    const id = await recordExpense(db, expense({ category: 'gear', receiptKey: KEY }));
    await recordEntry(db, {
      occurredOn: new Date('2026-11-17T00:00:00Z'), direction: 'out', amount: 50,
      description: 'מברגה', accountId, seasonId, recordedBy: LEAD,
    });
    const rows = await listLedgerRows(db, { seasonId });
    const mine = rows.find((row) => row.id === id)!;
    expect(mine).toMatchObject({ expenseCategory: 'gear', hasReceipt: true, editable: true });
    expect(JSON.stringify(mine)).not.toContain('receipts/');
    const plain = rows.find((row) => row.description === 'מברגה')!;
    expect(plain).toMatchObject({ expenseCategory: null, hasReceipt: false });
  });

  it.each([
    ['a zero amount', { amount: 0 }, EXPENSE_REFUSALS.amount],
    ['a negative amount', { amount: -5 }, EXPENSE_REFUSALS.amount],
    ['an amount that is not a number', { amount: Number.NaN }, EXPENSE_REFUSALS.amount],
    ['a blank description', { description: '  ' }, EXPENSE_REFUSALS.description],
    ['no date', { occurredOn: new Date('') }, EXPENSE_REFUSALS.noDate],
    ['no account', { accountId: '' }, EXPENSE_REFUSALS.pickAccount],
    ['an account that does not exist', { accountId: '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a' }, EXPENSE_REFUSALS.noAccount],
    ['no season', { seasonId: '' }, EXPENSE_REFUSALS.pickSeason],
    ['a season that does not exist', { seasonId: '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a' }, EXPENSE_REFUSALS.noSeason],
    ['a category outside the list', { category: 'snacks' as never }, EXPENSE_REFUSALS.category],
    ['a receipt key this module did not write', { receiptKey: 'uploads/camp-fees.xlsx' }, EXPENSE_REFUSALS.receipt],
    ['a receipt key that climbs out of its folder', { receiptKey: 'receipts/../uploads/x.jpg' }, EXPENSE_REFUSALS.receipt],
  ])('refuses %s in Hebrew, and writes nothing', async (_label, over, sentence) => {
    await expect(recordExpense(db, expense(over))).rejects.toThrow(sentence);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it('refuses a closed account', async () => {
    await db.update(accounts).set({ closedAt: new Date() }).where(eq(accounts.id, accountId));
    await expect(recordExpense(db, expense())).rejects.toThrow(EXPENSE_REFUSALS.closedAccount);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });
});

describe('the expenses one account recorded', () => {
  it('lists only that account\'s own, for the season asked, newest first', async () => {
    await recordExpense(db, expense({ description: 'ישן', occurredOn: new Date('2026-11-01T00:00:00Z') }));
    await recordExpense(db, expense({ description: 'חדש', category: 'power', receiptKey: KEY }));
    await recordExpense(db, expense({ description: 'של מישהו אחר', recordedBy: LEAD }));
    await recordExpense(db, expense({ description: 'שנה אחרת', seasonId: otherSeasonId }));

    const rows = await listOwnExpenses(db, { recordedBy: BUYER, seasonId });
    expect(rows.map((row) => row.description)).toEqual(['חדש', 'ישן']);
    expect(rows[0]).toMatchObject({
      amountAgorot: 18450, category: 'power', accountName: 'קופת מזומן', accountFund: 'camp',
      hasReceipt: true,
    });
    expect(rows[1]).toMatchObject({ category: null, hasReceipt: false });
  });

  it('leaves out money in, and both legs of a transfer', async () => {
    const other = (await createAccount(db, { name: 'עו״ש אופק', kind: 'personal' })).id;
    await recordEntry(db, {
      occurredOn: new Date('2026-11-18T00:00:00Z'), direction: 'in', amount: 900,
      description: 'תרומה', accountId, seasonId, recordedBy: BUYER,
    });
    await recordTransfer(db, {
      fromAccountId: accountId, toAccountId: other, amount: 300,
      occurredOn: new Date('2026-11-18T00:00:00Z'), description: 'העברה', recordedBy: BUYER, seasonId,
    });
    expect(await listOwnExpenses(db, { recordedBy: BUYER, seasonId })).toEqual([]);
  });
});

describe('the receipt of a movement', () => {
  it('answers with the key and who recorded it', async () => {
    const id = await recordExpense(db, expense({ receiptKey: KEY }));
    expect(await receiptOf(db, id)).toEqual({ receiptKey: KEY, recordedBy: BUYER });
  });

  it('answers null for a movement with no photo, and for an id that names nothing', async () => {
    const id = await recordExpense(db, expense());
    expect(await receiptOf(db, id)).toBeNull();
    expect(await receiptOf(db, '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a')).toBeNull();
  });
});

describe('removing an expense', () => {
  it('removes the author\'s own, and the balance goes back', async () => {
    const id = await recordExpense(db, expense({ amount: 200 }));
    await deleteOwnExpense(db, id, BUYER);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
    const balances = await accountBalances(db);
    expect(balances.find((one) => one.accountId === accountId)!.balanceAgorot).toBe(0);
  });

  it('refuses somebody else\'s expense, and leaves it where it was', async () => {
    const id = await recordExpense(db, expense({ recordedBy: LEAD }));
    await expect(deleteOwnExpense(db, id, BUYER)).rejects.toThrow(EXPENSE_REFUSALS.notYours);
    expect(await db.select().from(ledgerEntries)).toHaveLength(1);
  });

  it('refuses an id that names nothing', async () => {
    await expect(deleteOwnExpense(db, '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a', BUYER))
      .rejects.toThrow(EXPENSE_REFUSALS.missing);
  });

  it('keeps the ledger\'s own refusal for a movement that closes a debt', async () => {
    const id = await recordExpense(db, expense({ amount: 300 }));
    const debt = await createObligation(db, {
      direction: 'camp_owes', partyName: 'רוני אדלר', description: 'קרח', amount: 300, openedOn: null,
    });
    await settleObligation(db, {
      obligationId: debt, amount: 300, kind: 'cash', ledgerEntryId: id,
      settledOn: new Date('2026-11-18T00:00:00Z'), recordedBy: LEAD,
    });
    await expect(deleteOwnExpense(db, id, BUYER)).rejects.toThrow();
    expect(await db.select().from(ledgerEntries)).toHaveLength(1);
  });
});
