import { eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { HebrewRefusal } from '@/lib/errors/hebrew';
import { seasons } from '@/db/schema/camp';
import { accountBalances, unattributedAgorot } from './accounts';
import type { AccountBalance, Unattributed } from './accounts';
import { ledgerTotals } from './ledger';
import { listObligations, unnamedObligations } from './obligations';
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
   *  because a guessed account is worse than an admitted gap. Scoped to this
   *  season, unlike `accounts`. */
  unattributed: Unattributed;
  ledger: { inAgorot: number; outAgorot: number; netAgorot: number; count: number };
  identity: DuesFundingIdentity;
  campOwes: ObligationRow[];
  owedToCamp: ObligationRow[];
  /** Sum of `outstandingAgorot`, not `amountAgorot` — a partly settled debt
   *  must not be shown as though nothing has been paid against it. */
  campOwesAgorot: number;
  owedToCampAgorot: number;
  /** Every unnamed obligation camp-wide, from both directions and
   *  regardless of season — including one with no season at all.
   *  Deliberately *not* filtered from `campOwes`/`owedToCamp` above: those
   *  two are season-scoped (`season_id = $1`, which a NULL season_id never
   *  matches), so a season-less unnamed row would appear on no season's page
   *  under that approach. An unnamed obligation must surface "permanently in
   *  a block that cannot be dismissed" regardless of which season is open,
   *  so this comes from the camp-wide `unnamedObligations` query instead. */
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
  // `HebrewRefusal`, not `Error`: the message interpolates a uuid, a uuid is
  // hex, and `toHebrewError`'s alphabet passthrough rejects any message
  // carrying a Latin letter — so as a plain `Error` this reached the lead as
  // the generic fallback and the reason was lost (§5 A20).
  if (!season) throw new HebrewRefusal(`עונה לא נמצאה: ${seasonId}`);

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
    unattributed: await unattributedAgorot(db, seasonId),
    ledger: await ledgerTotals(db, { seasonId }),
    identity: await duesFundingIdentity(db, seasonId),
    campOwes,
    owedToCamp,
    campOwesAgorot: sumOutstanding(campOwes),
    owedToCampAgorot: sumOutstanding(owedToCamp),
    unnamed: await unnamedObligations(db),
  };
}
