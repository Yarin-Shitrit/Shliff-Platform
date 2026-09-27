import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { accounts, ledgerEntries } from '@/db/schema/money';
import type { AccountKind, LedgerDirection } from '@/db/schema/money';
import { persons, payments, dues } from '@/db/schema/camp';
import { toAgorot, fromAgorot } from '@/lib/money';
import { isBlank } from '@/lib/text/normalize';
import { insideCount } from './counted';

export type Account = typeof accounts.$inferSelect;

export interface NewAccount {
  name: string;
  kind: AccountKind;
  holderPersonId?: string;
  /** In shekels. */
  openingBalance?: number;
  openingOn?: Date;
  closedAt?: Date;
}

export interface AccountBalance {
  accountId: string;
  name: string;
  kind: AccountKind;
  holderPersonId: string | null;
  holderName: string | null;
  balanceAgorot: number;
  /** The day `opening_balance` was counted. Movements up to and including
   *  it are inside the figure already and do not move it; null means the
   *  balance is a true opening and every movement counts. */
  countedOn: Date | null;
}

export async function createAccount(db: AnyDb, input: NewAccount): Promise<Account> {
  if (isBlank(input.name)) throw new Error('לחשבון חייב להיות שם');
  const [row] = await db.insert(accounts).values({
    name: input.name,
    kind: input.kind,
    holderPersonId: input.holderPersonId ?? null,
    openingBalance: fromAgorot(toAgorot(input.openingBalance ?? 0)),
    openingOn: input.openingOn ?? null,
    closedAt: input.closedAt ?? null,
  }).returning();
  return row;
}

export async function listAccounts(db: AnyDb): Promise<Account[]> {
  return db.select().from(accounts).orderBy(accounts.name);
}

/**
 * The accounts a payment may be attributed to: everything not closed, in name
 * order. A closed קופה cannot receive money today, so offering it in a picker
 * would be offering a mistake.
 */
export async function listOpenAccounts(db: AnyDb): Promise<Account[]> {
  return db.select().from(accounts).where(isNull(accounts.closedAt)).orderBy(accounts.name);
}

/**
 * The counted balance, plus every movement in, minus every movement out,
 * **after the day it was counted** — from both `ledger_entries` and
 * `payments`, because a dues payment is money that physically arrived
 * somewhere.
 *
 * A movement on or before `opening_on` is history the count already holds:
 * giving it an account files it under that קופה without moving the figure.
 * `insideCount` says why, and why the cut is by camp calendar day.
 */
export async function accountBalances(db: AnyDb): Promise<AccountBalance[]> {
  const rows = await db
    .select({
      accountId: accounts.id,
      name: accounts.name,
      kind: accounts.kind,
      holderPersonId: accounts.holderPersonId,
      holderName: persons.displayName,
      openingBalance: accounts.openingBalance,
      countedOn: accounts.openingOn,
    })
    .from(accounts)
    .leftJoin(persons, eq(persons.id, accounts.holderPersonId))
    .orderBy(accounts.name);
  const countedOnById = new Map(rows.map((row) => [row.accountId, row.countedOn]));

  const entries = await db
    .select({ accountId: ledgerEntries.accountId, direction: ledgerEntries.direction,
              amount: ledgerEntries.amount, occurredOn: ledgerEntries.occurredOn })
    .from(ledgerEntries);

  const paid = await db
    .select({ accountId: payments.accountId, amount: payments.amount, paidOn: payments.paidOn })
    .from(payments);

  const delta = new Map<string, number>();
  for (const row of entries) {
    if (!row.accountId) continue;
    if (insideCount(row.occurredOn, countedOnById.get(row.accountId) ?? null)) continue;
    const signed = row.direction === 'in' ? toAgorot(row.amount) : -toAgorot(row.amount);
    delta.set(row.accountId, (delta.get(row.accountId) ?? 0) + signed);
  }
  for (const row of paid) {
    if (!row.accountId) continue;
    if (insideCount(row.paidOn, countedOnById.get(row.accountId) ?? null)) continue;
    delta.set(row.accountId, (delta.get(row.accountId) ?? 0) + toAgorot(row.amount));
  }

  return rows.map((row) => ({
    accountId: row.accountId,
    name: row.name,
    kind: row.kind,
    holderPersonId: row.holderPersonId,
    holderName: row.holderName ?? null,
    balanceAgorot: toAgorot(row.openingBalance) + (delta.get(row.accountId) ?? 0),
    countedOn: row.countedOn,
  }));
}

export interface Unattributed {
  /** Money in, with no account named. */
  inAgorot: number;
  /** Money out, with no account named. */
  outAgorot: number;
  /** Dues payments with no account. Offsets are excluded: they move no cash,
   *  so having no account is correct for them rather than missing. */
  paymentsAgorot: number;
}

/**
 * Money the system holds but cannot place. Shown on the page as its own line,
 * because an unattributed shekel assigned to a guessed account is worse than
 * one the page admits it cannot place.
 *
 * Split by direction — money that came in and money that went out are
 * different facts, and summing them (as an earlier version of this function
 * did) produced a number that was not a quantity of anything. When
 * `seasonId` is given, every total is scoped to it; omitted, each is
 * camp-wide, matching `accountBalances`'s own camp-wide scope.
 *
 * `קיזוז` payments are excluded: they move no cash, so having no account is
 * correct for them rather than missing.
 */
export async function unattributedAgorot(
  db: AnyDb, seasonId?: string,
): Promise<Unattributed> {
  const directionTotal = async (direction: LedgerDirection): Promise<number> => {
    const where = seasonId
      ? and(
          sql`${ledgerEntries.accountId} is null`,
          eq(ledgerEntries.direction, direction),
          eq(ledgerEntries.seasonId, seasonId),
        )
      : and(sql`${ledgerEntries.accountId} is null`, eq(ledgerEntries.direction, direction));
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)` })
      .from(ledgerEntries)
      .where(where);
    return toAgorot(row.total);
  };

  // A dues payment has no `seasonId` of its own — it is reached through the
  // due it settles — so scoping it to a season means joining `dues` rather
  // than filtering the table directly.
  const paymentsTotal = async (): Promise<number> => {
    if (seasonId) {
      const [row] = await db
        .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
        .from(payments)
        .innerJoin(dues, eq(dues.id, payments.dueId))
        .where(and(
          sql`${payments.accountId} is null`,
          sql`${payments.channel} <> 'קיזוז'`,
          eq(dues.seasonId, seasonId),
        ));
      return toAgorot(row.total);
    }
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .where(and(
        sql`${payments.accountId} is null`,
        sql`${payments.channel} <> 'קיזוז'`,
      ));
    return toAgorot(row.total);
  };

  return {
    inAgorot: await directionTotal('in'),
    outAgorot: await directionTotal('out'),
    paymentsAgorot: await paymentsTotal(),
  };
}
