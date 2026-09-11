import { eq, sql } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { accounts, ledgerEntries } from '@/db/schema/money';
import type { AccountKind } from '@/db/schema/money';
import { persons, payments } from '@/db/schema/camp';
import { toAgorot, fromAgorot } from '@/lib/money';
import { isBlank } from '@/lib/text/normalize';

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
 * Opening balance, plus every movement in, minus every movement out — from
 * both `ledger_entries` and `payments`, because a dues payment is money that
 * physically arrived somewhere.
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
    })
    .from(accounts)
    .leftJoin(persons, eq(persons.id, accounts.holderPersonId))
    .orderBy(accounts.name);

  const entries = await db
    .select({ accountId: ledgerEntries.accountId, direction: ledgerEntries.direction,
              amount: ledgerEntries.amount })
    .from(ledgerEntries);

  const paid = await db
    .select({ accountId: payments.accountId, amount: payments.amount })
    .from(payments);

  const delta = new Map<string, number>();
  for (const row of entries) {
    if (!row.accountId) continue;
    const signed = row.direction === 'in' ? toAgorot(row.amount) : -toAgorot(row.amount);
    delta.set(row.accountId, (delta.get(row.accountId) ?? 0) + signed);
  }
  for (const row of paid) {
    if (!row.accountId) continue;
    delta.set(row.accountId, (delta.get(row.accountId) ?? 0) + toAgorot(row.amount));
  }

  return rows.map((row) => ({
    accountId: row.accountId,
    name: row.name,
    kind: row.kind,
    holderPersonId: row.holderPersonId,
    holderName: row.holderName ?? null,
    balanceAgorot: toAgorot(row.openingBalance) + (delta.get(row.accountId) ?? 0),
  }));
}

/**
 * Money the system holds but cannot place. Shown on the page as its own line,
 * because an unattributed shekel assigned to a guessed account is worse than
 * one the page admits it cannot place.
 *
 * `קיזוז` payments are excluded: they move no cash, so having no account is
 * correct for them rather than missing.
 */
export async function unattributedAgorot(
  db: AnyDb,
): Promise<{ paymentsAgorot: number; entriesAgorot: number }> {
  const [p] = await db
    .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
    .from(payments)
    .where(sql`${payments.accountId} is null and ${payments.channel} <> 'קיזוז'`);

  const [e] = await db
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)` })
    .from(ledgerEntries)
    .where(sql`${ledgerEntries.accountId} is null`);

  return { paymentsAgorot: toAgorot(p.total), entriesAgorot: toAgorot(e.total) };
}
