import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { createAccount } from './accounts';
import { recordEntry } from './ledger';
import { createBudgetLine } from './budget';
import { createFundingTarget } from './funding';
import { createObligation, settleObligation } from './obligations';
import { seasonMoneySummary } from './summary';

let db: TestDb;
let s26: string;

beforeEach(async () => {
  db = await createTestDb();
  s26 = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35 })).id;
});

describe('the season money summary', () => {
  it('gathers balances, totals, the identity and what is owed in one call', async () => {
    const kupa = await createAccount(db, { name: 'קופת מזומן', kind: 'cash', openingBalance: 1584 });
    await recordEntry(db, {
      occurredOn: new Date('2026-07-18T00:00:00Z'), direction: 'in', amount: 57000,
      description: 'רווח מסיבת פקאנים', accountId: kupa.id, seasonId: s26, recordedBy: 'lead',
    });
    await createBudgetLine(db, { seasonId: s26, label: 'הכל', total: 64375.3, category: 'camp' });
    await createFundingTarget(db, {
      seasonId: s26, label: 'הורדת מחיר דמי קאמפ', amount: 22375.3, countsTowardCampBudget: true,
    });
    await createObligation(db, {
      direction: 'camp_owes', partyName: 'יוסף', description: 'חוב יוסף',
      amount: 15240, openedOn: new Date('2026-06-01T00:00:00Z'), seasonId: s26,
    });

    const summary = await seasonMoneySummary(db, s26);

    expect(summary.seasonName).toBe('ברן 26');
    expect(summary.totalBalanceAgorot).toBe(5858400);
    expect(summary.accounts).toHaveLength(1);
    expect(summary.identity.closes).toBe(true);
    expect(summary.identity.perPersonFullAgorot).toBe(183929);
    expect(summary.ledger.inAgorot).toBe(5700000);
    expect(summary.campOwesAgorot).toBe(1524000);
    expect(summary.owedToCampAgorot).toBe(0);
  });

  it('reports unattributed money rather than folding it into an account, scoped to its own season', async () => {
    const other = await createSeason(db, { name: 'ברן 27', year: 2027, flatRate: 1300 });
    await recordEntry(db, {
      occurredOn: new Date(), direction: 'in', amount: 250,
      description: 'בלי חשבון', seasonId: s26, recordedBy: 'lead',
    });
    // A different season's unattributed money must not leak into this one's
    // figure — the exact bug that showed the same total on every season.
    await recordEntry(db, {
      occurredOn: new Date(), direction: 'in', amount: 900,
      description: 'בלי חשבון בעונה אחרת', seasonId: other.id, recordedBy: 'lead',
    });
    const summary = await seasonMoneySummary(db, s26);
    expect(summary.unattributed.inAgorot).toBe(25000);
    expect(summary.totalBalanceAgorot).toBe(0);
  });

  it('keeps account balances camp-wide, unaffected by which season is queried', async () => {
    // A קופה does not reset at the burn: money moved under a *different*
    // season must still count here, or switching seasons on the page would
    // make the camp's cash appear to change — the exact bug this module
    // exists to prevent.
    const s27 = (await createSeason(
      db, { name: 'ברן 27', year: 2027, flatRate: 1300, plannedSize: 30 },
    )).id;
    const kupa = await createAccount(db, { name: 'קופת מזומן', kind: 'cash' });
    await recordEntry(db, {
      occurredOn: new Date('2027-01-01T00:00:00Z'), direction: 'in', amount: 100,
      description: 'הפקדה תחת עונה אחרת', accountId: kupa.id, seasonId: s27, recordedBy: 'lead',
    });

    const summary = await seasonMoneySummary(db, s26);
    expect(summary.totalBalanceAgorot).toBe(10000);
  });

  it('counts what is still owed once a debt is partly settled, not the original amount', async () => {
    const obligationId = await createObligation(db, {
      direction: 'camp_owes', partyName: 'רותם', description: 'חוב רותם',
      amount: 1000, openedOn: new Date('2026-06-01T00:00:00Z'), seasonId: s26,
    });
    await settleObligation(db, {
      obligationId, amount: 400, kind: 'cash',
      settledOn: new Date('2026-07-01T00:00:00Z'), recordedBy: 'lead',
    });

    const summary = await seasonMoneySummary(db, s26);
    expect(summary.campOwesAgorot).toBe(60000);
  });

  it('surfaces obligations with no party so nobody is silently owed money by no one', async () => {
    await createObligation(db, {
      direction: 'owed_to_camp', description: 'מישהו כיסה את החדר, לא ידוע מי',
      amount: 300, openedOn: new Date('2026-06-15T00:00:00Z'), seasonId: s26,
    });

    const summary = await seasonMoneySummary(db, s26);
    expect(summary.unnamed).toHaveLength(1);
    expect(summary.unnamed[0].outstandingAgorot).toBe(30000);
  });

  /**
   * `campOwes`/`owedToCamp` are season-scoped: `season_id = $1` is false for
   * a NULL row, so a season-less obligation appears in neither. Requirement
   * 5 tells Wave 2's promoter to leave the season unset when it can't be
   * determined, and requirement 19 says an unnamed obligation must surface
   * "permanently in a block that cannot be dismissed" — so `unnamed` must
   * come from the camp-wide query (`unnamedObligations`), not from filtering
   * the two season-scoped lists, or a season-less unnamed row reaches no
   * season's page at all, under any season.
   */
  it('surfaces a season-less unnamed obligation too, on a season it has nothing to do with', async () => {
    await createObligation(db, {
      direction: 'camp_owes', description: 'שולם 500 — מקפיא באיחסון נוסף',
      amount: 500, openedOn: new Date('2026-06-20T00:00:00Z'),
      // no seasonId: exactly the row requirement 5 says the promoter must
      // produce when the season cannot be determined.
    });

    const summary = await seasonMoneySummary(db, s26);
    expect(summary.unnamed).toHaveLength(1);
    expect(summary.unnamed[0].outstandingAgorot).toBe(50000);
    expect(summary.unnamed[0].seasonId).toBeNull();
  });
});
