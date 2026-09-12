import { eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { seasons } from '@/db/schema/camp';
import { accountBalances, unattributedAgorot } from './accounts';
import type { AccountBalance } from './accounts';
import { ledgerTotals } from './ledger';
import { listObligations } from './obligations';
import type { ObligationRow } from './obligations';
import { duesFundingIdentity } from './funding';
import type { DuesFundingIdentity } from './funding';

export interface SeasonMoneySummary {
  seasonId: string;
  seasonName: string;
  /** Camp-wide, not season-scoped — a קופה does not reset at the burn. */
  accounts: AccountBalance[];
  totalBalanceAgorot: number;
  /** Money the system holds but cannot place. Never folded into an account,
   *  because a guessed account is worse than an admitted gap. */
  unattributed: { paymentsAgorot: number; entriesAgorot: number };
  ledger: { inAgorot: number; outAgorot: number; netAgorot: number; count: number };
  identity: DuesFundingIdentity;
  campOwes: ObligationRow[];
  owedToCamp: ObligationRow[];
  /** Sum of `outstandingAgorot`, not `amountAgorot` — a partly settled debt
   *  must not be shown as though nothing has been paid against it. */
  campOwesAgorot: number;
  owedToCampAgorot: number;
  /** Obligations with no linked person and no recorded name, from both
   *  directions. Surfaced on the summary itself rather than left for a
   *  second query, because these are exactly the rows nobody can act on
   *  without first finding out who they are. */
  unnamed: ObligationRow[];
}

/**
 * Everything the season money page needs, in one call.
 *
 * Deliberately one shape rather than seven exported queries: the page is a
 * server component, and a summary that forces it into a second round trip
 * to fill a hole is a data-shape defect, not a page defect.
 *
 * Account balances are camp-wide, not season-scoped: a קופה does not reset
 * at the burn, so switching seasons must never appear to change how much
 * cash the camp holds. Ledger totals, obligations and the funding identity
 * are season-scoped, because those genuinely differ season to season.
 */
export async function seasonMoneySummary(
  db: AnyDb, seasonId: string,
): Promise<SeasonMoneySummary> {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!season) throw new Error(`עונה לא נמצאה: ${seasonId}`);

  const accounts = await accountBalances(db);
  const campOwes = await listObligations(db, { direction: 'camp_owes', seasonId });
  const owedToCamp = await listObligations(db, { direction: 'owed_to_camp', seasonId });

  const sumOutstanding = (rows: ObligationRow[]) =>
    rows.reduce((total, row) => total + row.outstandingAgorot, 0);

  return {
    seasonId,
    seasonName: season.name,
    accounts,
    totalBalanceAgorot: accounts.reduce((total, row) => total + row.balanceAgorot, 0),
    unattributed: await unattributedAgorot(db),
    ledger: await ledgerTotals(db, { seasonId }),
    identity: await duesFundingIdentity(db, seasonId),
    campOwes,
    owedToCamp,
    campOwesAgorot: sumOutstanding(campOwes),
    owedToCampAgorot: sumOutstanding(owedToCamp),
    unnamed: [...campOwes, ...owedToCamp].filter((row) => row.unnamed),
  };
}
