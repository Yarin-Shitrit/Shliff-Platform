import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { accounts, ledgerEntries } from '@/db/schema/money';
import type { AccountKind, LedgerDirection } from '@/db/schema/money';
import { persons, payments, dues } from '@/db/schema/camp';
import { toAgorot, fromAgorot } from '@/lib/money';
import { HebrewRefusal } from '@/lib/errors/hebrew';
import { isBlank } from '@/lib/text/normalize';
import { insideCount, campDayKey } from './counted';

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
  /** The figure the camp counted — `opening_balance` — before any movement
   *  after `countedOn` is added. Equal to `balanceAgorot` on the count day. */
  countedAgorot: number;
  /** The day `opening_balance` was counted. Movements up to and including
   *  it are inside the figure already and do not move it; null means the
   *  balance is a true opening and every movement counts. */
  countedOn: Date | null;
  closed: boolean;
}

/**
 * A new place money sits. `openingBalance` with `openingOn` is a count (see
 * `countAccount`); with no `openingOn` it is a true opening that every
 * movement builds on. The blank-name refusal is a `HebrewRefusal` because a
 * screen now raises it (§5 A20); the duplicate-name refusal is the driver's,
 * `accounts_name_unique`, mapped where the screen's action catches it.
 */
export async function createAccount(db: AnyDb, input: NewAccount): Promise<Account> {
  if (isBlank(input.name)) throw new HebrewRefusal('לחשבון חייב להיות שם');
  if (input.openingOn !== undefined && campDayKey(input.openingOn) > campDayKey(new Date())) {
    throw new HebrewRefusal('תאריך הספירה לא יכול להיות בעתיד.');
  }
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
 * `insideCount` says why, and why the cut is by camp calendar day. With no
 * count day every movement counts, which is the plain opening-plus-movements
 * rule this function used to apply to everything.
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
      closedAt: accounts.closedAt,
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
    countedAgorot: toAgorot(row.openingBalance),
    countedOn: row.countedOn,
    closed: row.closedAt !== null,
  }));
}

export interface CountInput {
  accountId: string;
  /** In shekels. What the account holds — may be negative for a personal
   *  account whose holder has laid out more than they were given. */
  balance: number;
  /** The day the figure stands for. Never later than today. */
  countedOn: Date;
}

export interface CountResult {
  /** Movements on or before the count day that name this account — the
   *  ones the new figure already holds and that stop moving it. */
  insideCount: number;
  /** Movements after the count day that name this account — the ones the
   *  figure is still built on. */
  afterCount: number;
}

/**
 * Records what an account holds as of a day, from the screen.
 *
 * This is the one write to `opening_balance` and `opening_on` after an
 * account exists. It replaces, never appends: an account carries one count,
 * and a second count is the camp saying "this is what it is now" — the
 * earlier figure was a count of an earlier day, and the movements between
 * the two are history to the new one exactly as the movements before the
 * first were history to it. The drawer says that before the button.
 *
 * Three refusals, all `HebrewRefusal` (§5 A20) because each is a decision
 * and not a failure: no such account; an account already closed, which can
 * hold nothing today; and a day in the future, which nobody has counted yet.
 * `NaN` is left to `toAgorot`, whose message `MONEY_ERRORS` already maps.
 *
 * The counts come back so the action can say what the figure now rests on:
 * the number of movements it absorbs and the number it is still built from.
 */
export async function countAccount(db: AnyDb, input: CountInput): Promise<CountResult> {
  const [account] = await db
    .select({ id: accounts.id, closedAt: accounts.closedAt })
    .from(accounts)
    .where(eq(accounts.id, input.accountId));
  if (!account) throw new HebrewRefusal('אין חשבון כזה.');
  if (account.closedAt !== null) throw new HebrewRefusal('החשבון הזה נסגר, ואי אפשר לספור אותו.');
  if (campDayKey(input.countedOn) > campDayKey(new Date())) {
    throw new HebrewRefusal('תאריך הספירה לא יכול להיות בעתיד.');
  }

  await db.update(accounts)
    .set({
      openingBalance: fromAgorot(toAgorot(input.balance)),
      openingOn: input.countedOn,
    })
    .where(eq(accounts.id, input.accountId));

  const entries = await db
    .select({ occurredOn: ledgerEntries.occurredOn })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.accountId, input.accountId));
  const paid = await db
    .select({ occurredOn: payments.paidOn })
    .from(payments)
    .where(eq(payments.accountId, input.accountId));

  let inside = 0;
  let after = 0;
  for (const row of [...entries, ...paid]) {
    if (insideCount(row.occurredOn, input.countedOn)) inside += 1;
    else after += 1;
  }
  return { insideCount: inside, afterCount: after };
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

/**
 * Who holds the account from now on: a person on the roster, or nobody.
 *
 * The holder is otherwise written once, at creation, and the new-account
 * drawer offers no picker. The one thing that needs it changed afterwards
 * is a person on their way out: `deletePerson` refuses while an account
 * names them, because `set null` would leave `חשבון פרטי של ___` on the
 * card with nothing saying whose it was. So the lead says whose it is now.
 * A merged-away person cannot be chosen — their money lives on the record
 * they were merged into.
 */
export async function setAccountHolder(
  db: AnyDb, accountId: string, holderPersonId: string | null,
): Promise<void> {
  const [account] = await db.select({ id: accounts.id })
    .from(accounts).where(eq(accounts.id, accountId));
  if (!account) throw new HebrewRefusal('אין חשבון כזה.');

  if (holderPersonId !== null) {
    const [person] = await db.select({ id: persons.id, mergedIntoId: persons.mergedIntoId })
      .from(persons).where(eq(persons.id, holderPersonId));
    if (!person || person.mergedIntoId !== null) {
      throw new HebrewRefusal('האדם שנבחר לא נמצא ברשימת האנשים.');
    }
  }

  await db.update(accounts).set({ holderPersonId }).where(eq(accounts.id, accountId));
}
