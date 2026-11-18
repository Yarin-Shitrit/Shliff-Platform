import { eq, sql } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { accounts, ledgerEntries } from '@/db/schema/money';
import type { AccountFund } from '@/db/schema/money';
import { dues, payments } from '@/db/schema/camp';
import { toAgorot } from '@/lib/money';
import type { AccountBalance } from './accounts';
import { fundOf } from './labels';

/** A pot, or the accounts nobody has placed in one. */
export type FundKey = AccountFund | 'unassigned';

export interface FundBalance {
  balanceAgorot: number;
  accountCount: number;
}

export type FundBalances = Record<FundKey, FundBalance>;

/** The pot an account is summed into. Anything that is not a pot — null, or
 *  a bad stored value — is `unassigned`, never dropped. */
export function fundKeyOf(fund: AccountFund | null): FundKey {
  return fundOf(fund) ?? 'unassigned';
}

/**
 * What each pot holds: the sum of its accounts' balances.
 *
 * A pure reduce over `accountBalances`' rows, so a pot's figure is the sum of
 * the cards drawn under it and the two can never disagree. An account with no
 * pot is counted under `unassigned` and in neither pot — folding it into one
 * would be a guess about whose money it is.
 *
 * There is deliberately no grand total here. The camp's money and the gift's
 * are different money, and one figure over both hides a pot that is overdrawn
 * behind one that is not.
 */
export function fundBalances(
  rows: ReadonlyArray<Pick<AccountBalance, 'fund' | 'balanceAgorot'>>,
): FundBalances {
  const totals: FundBalances = {
    camp: { balanceAgorot: 0, accountCount: 0 },
    gift: { balanceAgorot: 0, accountCount: 0 },
    unassigned: { balanceAgorot: 0, accountCount: 0 },
  };
  for (const row of rows) {
    const total = totals[fundKeyOf(row.fund)];
    total.balanceAgorot += row.balanceAgorot;
    total.accountCount += 1;
  }
  return totals;
}

export interface FundFlow {
  inAgorot: number;
  outAgorot: number;
}

export type FundFlows = Record<FundKey, FundFlow>;

/**
 * What came into and went out of each pot in one season.
 *
 * A movement belongs to the pot of the account it names — that is the only
 * place the pot is recorded — so a movement with no account is in none of
 * these figures. It is already reported, by direction, in the unattributed
 * banners (`unattributedAgorot`).
 *
 * Money in is the season's ledger inflow plus the dues paid against the
 * season's dues, because a dues payment is money that physically arrived in
 * an account. A `קיזוז` payment moves no cash and carries no account, so the
 * join leaves it out without being told to.
 *
 * Season-scoped, unlike a balance: this is "what happened this year", and it
 * equals the pot's balance only for an account that was never counted. The
 * two legs of a transfer are an out of one account and an in of the other,
 * and are counted as that.
 */
export async function fundSeasonFlows(db: AnyDb, seasonId: string): Promise<FundFlows> {
  const flows: FundFlows = {
    camp: { inAgorot: 0, outAgorot: 0 },
    gift: { inAgorot: 0, outAgorot: 0 },
    unassigned: { inAgorot: 0, outAgorot: 0 },
  };

  const entries = await db
    .select({
      fund: accounts.fund,
      direction: ledgerEntries.direction,
      total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)`,
    })
    .from(ledgerEntries)
    .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
    .where(eq(ledgerEntries.seasonId, seasonId))
    .groupBy(accounts.fund, ledgerEntries.direction);
  for (const row of entries) {
    const flow = flows[fundKeyOf(row.fund)];
    if (row.direction === 'in') flow.inAgorot += toAgorot(row.total);
    else flow.outAgorot += toAgorot(row.total);
  }

  const paid = await db
    .select({
      fund: accounts.fund,
      total: sql<string>`coalesce(sum(${payments.amount}), 0)`,
    })
    .from(payments)
    .innerJoin(dues, eq(dues.id, payments.dueId))
    .innerJoin(accounts, eq(accounts.id, payments.accountId))
    .where(eq(dues.seasonId, seasonId))
    .groupBy(accounts.fund);
  for (const row of paid) {
    flows[fundKeyOf(row.fund)].inAgorot += toAgorot(row.total);
  }

  return flows;
}
