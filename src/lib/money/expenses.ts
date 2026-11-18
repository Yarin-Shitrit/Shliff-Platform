import {
  and, desc, eq, isNull,
} from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { accounts, ledgerEntries } from '@/db/schema/money';
import type { AccountFund, ExpenseCategory } from '@/db/schema/money';
import { seasons } from '@/db/schema/camp';
import { toAgorot } from '@/lib/money';
import { HebrewRefusal } from '@/lib/errors/hebrew';
import { isBlank } from '@/lib/text/normalize';
import { deleteEntry, recordEntry } from './ledger';
import { isExpenseCategory } from './expense-categories';
import { receiptContentType } from './receipt-file';
import { EXPENSE_REFUSALS } from './expense-refusals';

export { EXPENSE_REFUSALS };

/**
 * An expense typed on /money/expenses: one `out` movement in the ledger, with
 * a category and, when one was photographed, a receipt.
 *
 * It is a ledger entry and nothing beside one — no second table — so the
 * ledger, the account balances and the budget all see it the moment it is
 * written, and there is no copy to drift.
 */
export interface NewExpense {
  occurredOn: Date;
  /** In shekels. Must be positive. */
  amount: number;
  description: string;
  /** Required: the form always says which of the camp's accounts paid. */
  accountId: string;
  /** Required, and chosen on the form — never derived from the date. */
  seasonId: string;
  category?: ExpenseCategory;
  receiptKey?: string;
  recordedBy: string;
}

export async function recordExpense(db: AnyDb, input: NewExpense): Promise<string> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new HebrewRefusal(EXPENSE_REFUSALS.amount);
  }
  if (isBlank(input.description)) throw new HebrewRefusal(EXPENSE_REFUSALS.description);
  if (Number.isNaN(input.occurredOn.getTime())) throw new HebrewRefusal(EXPENSE_REFUSALS.noDate);
  if (isBlank(input.accountId)) throw new HebrewRefusal(EXPENSE_REFUSALS.pickAccount);
  if (isBlank(input.seasonId)) throw new HebrewRefusal(EXPENSE_REFUSALS.pickSeason);
  if (input.category !== undefined && !isExpenseCategory(input.category)) {
    throw new HebrewRefusal(EXPENSE_REFUSALS.category);
  }
  if (input.receiptKey !== undefined && receiptContentType(input.receiptKey) === null) {
    throw new HebrewRefusal(EXPENSE_REFUSALS.receipt);
  }

  const [account] = await db.select({ closedAt: accounts.closedAt }).from(accounts)
    .where(eq(accounts.id, input.accountId));
  if (account === undefined) throw new HebrewRefusal(EXPENSE_REFUSALS.noAccount);
  // A closed account takes no new money out: its balance is finished business,
  // and the ledger would otherwise move a figure nobody is watching.
  if (account.closedAt !== null) throw new HebrewRefusal(EXPENSE_REFUSALS.closedAccount);

  const [season] = await db.select({ id: seasons.id }).from(seasons)
    .where(eq(seasons.id, input.seasonId));
  if (season === undefined) throw new HebrewRefusal(EXPENSE_REFUSALS.noSeason);

  return recordEntry(db, {
    occurredOn: input.occurredOn,
    direction: 'out',
    amount: input.amount,
    description: input.description.trim(),
    accountId: input.accountId,
    seasonId: input.seasonId,
    expenseCategory: input.category,
    receiptKey: input.receiptKey,
    recordedBy: input.recordedBy,
  });
}

export interface ExpenseRow {
  id: string;
  occurredOn: Date;
  amountAgorot: number;
  description: string;
  category: ExpenseCategory | null;
  accountName: string | null;
  accountFund: AccountFund | null;
  hasReceipt: boolean;
}

/**
 * What one account typed, newest first: money out, by hand, that is not half
 * of a transfer and not a party's line. That is every expense recorded on
 * /money/expenses, and also a plain `יצא` the same person typed on the ledger
 * screen — the same fact entered through another door, so it is listed too.
 */
export async function listOwnExpenses(
  db: AnyDb, filter: { recordedBy: string; seasonId: string },
): Promise<ExpenseRow[]> {
  const rows = await db
    .select({
      id: ledgerEntries.id,
      occurredOn: ledgerEntries.occurredOn,
      amount: ledgerEntries.amount,
      description: ledgerEntries.description,
      category: ledgerEntries.expenseCategory,
      accountName: accounts.name,
      accountFund: accounts.fund,
      receiptKey: ledgerEntries.receiptKey,
    })
    .from(ledgerEntries)
    .leftJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
    .where(and(
      eq(ledgerEntries.recordedBy, filter.recordedBy),
      eq(ledgerEntries.seasonId, filter.seasonId),
      eq(ledgerEntries.direction, 'out'),
      isNull(ledgerEntries.sourceBlockId),
      isNull(ledgerEntries.transferGroupId),
      isNull(ledgerEntries.eventId),
    ))
    .orderBy(desc(ledgerEntries.occurredOn), desc(ledgerEntries.createdAt));

  return rows.map((row) => ({
    id: row.id,
    occurredOn: row.occurredOn,
    amountAgorot: toAgorot(row.amount),
    description: row.description,
    category: row.category,
    accountName: row.accountName ?? null,
    accountFund: row.accountFund ?? null,
    hasReceipt: row.receiptKey !== null,
  }));
}

/** The receipt of one movement and who typed it, or null when there is no
 *  such movement or it carries no photo. */
export async function receiptOf(
  db: AnyDb, entryId: string,
): Promise<{ receiptKey: string; recordedBy: string } | null> {
  const [row] = await db
    .select({ receiptKey: ledgerEntries.receiptKey, recordedBy: ledgerEntries.recordedBy })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.id, entryId));
  if (row === undefined || row.receiptKey === null) return null;
  return { receiptKey: row.receiptKey, recordedBy: row.recordedBy };
}

/**
 * Removes an expense its own author typed by mistake. Someone holding only the
 * הוצאות grant may undo their own entry and nobody else's; every other refusal
 * — a sheet's row, a movement that closes a debt — is `deleteEntry`'s.
 *
 * The photo stays in storage: the store has no delete, and an orphaned
 * picture nobody can reach is cheaper than a second way to lose a receipt.
 */
export async function deleteOwnExpense(db: AnyDb, entryId: string, email: string): Promise<void> {
  const [row] = await db.select({ recordedBy: ledgerEntries.recordedBy }).from(ledgerEntries)
    .where(eq(ledgerEntries.id, entryId));
  if (row === undefined) throw new HebrewRefusal(EXPENSE_REFUSALS.missing);
  if (row.recordedBy !== email) throw new HebrewRefusal(EXPENSE_REFUSALS.notYours);
  await deleteEntry(db, entryId);
}
