import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { createBudgetLine } from './budget';
import {
  createFundingTarget, fundingTotalAgorot, campBudgetFundingAgorot,
  createTicketRound, ticketTotalAgorot, duesFundingIdentity,
} from './funding';

let db: TestDb;
let s26: string;

beforeEach(async () => {
  db = await createTestDb();
  s26 = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35 })).id;
});

describe('the fundraising plan', () => {
  it('sums the ברן 26 plan to 135,375.30', async () => {
    const plan: Array<[string, number]> = [
      ['חוב', 15000], ['תיקון ותחזוק מייצג', 5000], ['חשמל רחבה', 16000],
      ['הגברה', 35000], ['הובלה', 6000], ['תאורה לייזרים', 20000],
      ['מכולות', 16000], ['הורדת מחיר דמי קאמפ', 22375.3],
    ];
    for (const [label, amount] of plan) {
      await createFundingTarget(db, { seasonId: s26, label, amount });
    }
    expect(await fundingTotalAgorot(db, s26)).toBe(13537530);
  });

  it('sums the ticket projection to 171,000', async () => {
    await createTicketRound(db, { seasonId: s26, label: 'כרטיסים עד כה', total: 60000 });
    await createTicketRound(db, { seasonId: s26, label: 'סבב ג׳', quantity: 165, price: 200, total: 33000 });
    await createTicketRound(db, { seasonId: s26, label: 'סבב ד׳', quantity: 195, price: 400, total: 78000 });
    expect(await ticketTotalAgorot(db, s26)).toBe(17100000);
  });

  /**
   * The thesis of the camp's finances, and a sentence that appears in no cell
   * of any workbook: the full budget per head is 1,839.29, dues are 1,200, and
   * fundraising covers the 639.29 difference.
   */
  it('closes the dues/fundraising identity for ברן 26', async () => {
    await createBudgetLine(db, { seasonId: s26, label: 'הכל', total: 64375.3, category: 'camp' });
    await createFundingTarget(db, {
      seasonId: s26, label: 'הורדת מחיר דמי קאמפ', amount: 22375.3, countsTowardCampBudget: true,
    });

    const id = await duesFundingIdentity(db, s26);
    expect(id.budgetTotalAgorot).toBe(6437530);
    expect(id.duesCoverAgorot).toBe(4200000);
    expect(id.fundingTargetAgorot).toBe(2237530);
    expect(id.perPersonFullAgorot).toBe(183929);
    expect(id.perPersonFundingAgorot).toBe(63929);
    expect(id.flatRateAgorot).toBe(120000);
    expect(id.closes).toBe(true);
  });

  it('reports a gap rather than hiding it when the halves do not add up', async () => {
    await createBudgetLine(db, { seasonId: s26, label: 'הכל', total: 70000, category: 'camp' });
    await createFundingTarget(db, { seasonId: s26, label: 'גיוס', amount: 22375.3 });
    const id = await duesFundingIdentity(db, s26);
    expect(id.closes).toBe(false);
  });

  it('refuses to invent a per-person figure with no planned size', async () => {
    const s = (await createSeason(db, { name: 'ברן 27', year: 2027, flatRate: 1000 })).id;
    const id = await duesFundingIdentity(db, s);
    expect(id.plannedSize).toBeNull();
    expect(id.perPersonFullAgorot).toBeNull();
  });

  /**
   * ברן 26's own numbers (35 people) happen to divide with a remainder under
   * a half-agora, so `Math.round` and `Math.floor` land on the same integer
   * there and a mutant that floors instead of rounds would slip past the test
   * above undetected. This case is built so the two disagree — 10.03 / 4 and
   * 6.03 / 4 both carry a three-quarter-agora remainder — so flooring instead
   * of rounding is caught here even though it is invisible on ברן 26 itself.
   */
  it('rounds each per-person division to the nearest agora, not down', async () => {
    const s = (await createSeason(db, { name: 'ברן 29', year: 2029, flatRate: 999, plannedSize: 4 })).id;
    await createBudgetLine(db, { seasonId: s, label: 'הכל', total: 10.03, category: 'camp' });
    await createFundingTarget(db, {
      seasonId: s, label: 'גיוס', amount: 6.03, countsTowardCampBudget: true,
    });

    const id = await duesFundingIdentity(db, s);
    expect(id.perPersonFullAgorot).toBe(251);
    expect(id.perPersonFundingAgorot).toBe(151);
  });

  /**
   * The year's plan and the camp budget's share of it are different numbers.
   * 135,375.30 is what the camp must raise in total; 22,375.30 is the part
   * that keeps dues at 1,200 instead of 1,839.29. Summing all eight into the
   * identity compares the camp budget against money earmarked for the
   * dancefloor, the art car and last year's debt.
   */
  it('separates the year plan from the camp budget share', async () => {
    const plan: Array<[string, number, boolean]> = [
      ['חוב', 15000, false],
      ['תיקון ותחזוק מייצג', 5000, false],
      ['חשמל רחבה', 16000, false],
      ['הגברה', 35000, false],
      ['הובלה', 6000, false],
      ['תאורה לייזרים', 20000, false],
      ['מכולות', 16000, false],
      ['הורדת מחיר דמי קאמפ', 22375.3, true],
    ];
    for (const [label, amount, countsTowardCampBudget] of plan) {
      await createFundingTarget(db, { seasonId: s26, label, amount, countsTowardCampBudget });
    }

    expect(await fundingTotalAgorot(db, s26)).toBe(13537530);
    expect(await campBudgetFundingAgorot(db, s26)).toBe(2237530);
  });

  it('closes the identity against the camp share, not the whole plan', async () => {
    await createBudgetLine(db, { seasonId: s26, label: 'הכל', total: 64375.3, category: 'camp' });
    await createFundingTarget(db, { seasonId: s26, label: 'הגברה', amount: 35000 });
    await createFundingTarget(db, {
      seasonId: s26, label: 'הורדת מחיר דמי קאמפ', amount: 22375.3,
      countsTowardCampBudget: true,
    });

    const id = await duesFundingIdentity(db, s26);
    // the identity reports the camp share, not the 57,375.30 total
    expect(id.fundingTargetAgorot).toBe(2237530);
    expect(id.perPersonFundingAgorot).toBe(63929);
    expect(id.closes).toBe(true);
  });

  it('still reports a gap when the camp share does not cover the difference', async () => {
    await createBudgetLine(db, { seasonId: s26, label: 'הכל', total: 70000, category: 'camp' });
    await createFundingTarget(db, {
      seasonId: s26, label: 'הורדת מחיר דמי קאמפ', amount: 22375.3,
      countsTowardCampBudget: true,
    });
    expect((await duesFundingIdentity(db, s26)).closes).toBe(false);
  });

  it('defaults a target to not counting toward the camp budget', async () => {
    await createFundingTarget(db, { seasonId: s26, label: 'ארט קאר', amount: 25000 });
    expect(await fundingTotalAgorot(db, s26)).toBe(2500000);
    expect(await campBudgetFundingAgorot(db, s26)).toBe(0);
  });

  /**
   * The same mixing already fixed for the funding half, one column over: a
   * season's dancefloor budget is not part of what a member's dues buy. The
   * dancefloor line here (45,000) is nine times the camp line (5,000) so a
   * regression that sums both categories reports a per-head figure an order
   * of magnitude too high rather than one that happens to round the same way.
   */
  it('divides the per-head cost by the camp budget alone, not by the camp plus the dancefloor', async () => {
    const s = (await createSeason(db, { name: 'ברן 29', year: 2029, flatRate: 500, plannedSize: 10 })).id;
    await createBudgetLine(db, { seasonId: s, label: 'תקציב קאמפ', total: 5000, category: 'camp' });
    await createBudgetLine(db, { seasonId: s, label: 'תקציב רחבה', total: 45000, category: 'dancefloor' });

    const id = await duesFundingIdentity(db, s);
    expect(id.budgetTotalAgorot).toBe(500000);
    expect(id.perPersonFullAgorot).toBe(50000);
  });
});
