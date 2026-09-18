import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import {
  createBudgetLine, listBudgetLines, budgetTotalAgorot, budgetDerivation,
  listBudgetLinesWithActuals, groupBudgetByCategory, budgetTotals,
} from './budget';
import type { BudgetLineActuals } from './budget';
import { recordEntry } from './ledger';

let db: TestDb;
let s25: string;
let s26: string;

beforeEach(async () => {
  db = await createTestDb();
  s25 = (await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500, plannedSize: 43 })).id;
  s26 = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35 })).id;
});

describe('budget lines', () => {
  it('keeps a non-numeric quantity exactly as written', async () => {
    await createBudgetLine(db, {
      seasonId: s26, label: 'חשמל לקאמפ', quantityText: '12,000kw',
      unitCost: 7500, total: 7500, category: 'camp',
    });
    const [line] = await listBudgetLines(db, s26);
    expect(line.quantityText).toBe('12,000kw');
    expect(line.quantityNumAgorot).toBeNull();
    expect(line.arithmeticOff).toBe(false);
  });

  it('flags quantity × unit ≠ total without blocking it', async () => {
    const id = await createBudgetLine(db, {
      seasonId: s26, label: 'שירותים נסורת', quantityText: '5', quantityNum: 5,
      unitCost: 125, total: 1625, category: 'camp',
    });
    expect(id).toBeTruthy();
    const [line] = await listBudgetLines(db, s26);
    expect(line.arithmeticOff).toBe(true);
  });

  it('arithmetic off by ₪0.30 (within 50-agora tolerance) does not flag', async () => {
    // Tolerance is 50 agorot (₪0.50). An error of ₪0.30 (30 agorot) should be
    // within tolerance and not flagged.
    const id = await createBudgetLine(db, {
      seasonId: s26, label: 'בטולרנס', quantityText: '100', quantityNum: 100,
      unitCost: 10, total: 1000.3, category: 'camp',
    });
    expect(id).toBeTruthy();
    const [line] = await listBudgetLines(db, s26);
    expect(line.arithmeticOff).toBe(false);
  });

  it('arithmetic off by ₪0.60 (outside 50-agora tolerance) flags', async () => {
    // Tolerance is 50 agorot (₪0.50). An error of ₪0.60 (60 agorot) should
    // exceed tolerance and be flagged.
    const id = await createBudgetLine(db, {
      seasonId: s26, label: 'בחוץ-טולרנס', quantityText: '100', quantityNum: 100,
      unitCost: 10, total: 1000.6, category: 'camp',
    });
    expect(id).toBeTruthy();
    const [line] = await listBudgetLines(db, s26);
    expect(line.arithmeticOff).toBe(true);
  });

  it('sums the ברן 26 budget to 64,375.30', async () => {
    for (const [label, total] of [['בסיס', 58523], ['הפתעות', 5852.3]] as const) {
      await createBudgetLine(db, { seasonId: s26, label, total, category: 'camp' });
    }
    expect(await budgetTotalAgorot(db, s26)).toBe(6437530);
  });

  it('derives 26 from 25 and carries a 25 line that 26 dropped', async () => {
    await createBudgetLine(db, { seasonId: s25, label: 'סולם 5 מ׳', total: 1280, category: 'camp' });
    await createBudgetLine(db, { seasonId: s25, label: 'הובלה', total: 4000, category: 'camp' });
    await createBudgetLine(db, {
      seasonId: s26, label: 'הובלה', total: 9000, category: 'camp',
      rationale: 'תוספת של 2000 שקלים',
    });

    const rows = await budgetDerivation(db, s25, s26);
    const hovala = rows.find((r) => r.label === 'הובלה')!;
    expect(hovala.actualAgorot).toBe(400000);
    expect(hovala.forecastAgorot).toBe(900000);
    expect(hovala.bufferAgorot).toBe(500000);

    const dropped = rows.find((r) => r.label === 'סולם 5 מ׳')!;
    expect(dropped.forecastAgorot).toBeNull();
    expect(dropped.bufferAgorot).toBe(-128000);
  });

  it('refuses a blank label', async () => {
    await expect(createBudgetLine(db, {
      seasonId: s26, label: '‏  ', total: 100, category: 'camp',
    })).rejects.toThrow(/שם/);
  });

  /**
   * `budget_lines` is the single source for a season's planned spend.
   * `tasks.budgetAmount` still exists and is still written by the task form —
   * it is one deliverable's own figure, not part of the budget total. If it
   * ever leaked into this sum, every owned deliverable would be counted
   * twice and the ברן 26 total would stop reconciling with the workbook.
   */
  it('never counts a task budget toward the season budget', async () => {
    const { createTask } = await import('@/lib/work/tasks');
    await createTask(db, {
      seasonId: s26, kind: 'deliverable', title: 'חשמל', budgetAmount: 12950,
    });
    expect(await budgetTotalAgorot(db, s26)).toBe(0);

    await createBudgetLine(db, {
      seasonId: s26, label: 'חשמל', total: 12950, category: 'dancefloor',
    });
    expect(await budgetTotalAgorot(db, s26)).toBe(1295000);
  });

  /**
   * The same mixing Task 12b fixed for funding, one column over: a category
   * filter, not a second table, keeps a season's dancefloor spend out of a
   * total that is supposed to answer "what does the camp budget cover".
   */
  it('sums only the requested category, and both categories when none is given', async () => {
    await createBudgetLine(db, { seasonId: s26, label: 'תקציב קאמפ', total: 1000, category: 'camp' });
    await createBudgetLine(db, { seasonId: s26, label: 'תקציב רחבה', total: 400, category: 'dancefloor' });

    expect(await budgetTotalAgorot(db, s26)).toBe(140000);
    expect(await budgetTotalAgorot(db, s26, 'camp')).toBe(100000);
    expect(await budgetTotalAgorot(db, s26, 'dancefloor')).toBe(40000);
  });
});

describe('budget lines with actuals', () => {
  it('sums what the ledger has spent against each line, and what is left', async () => {
    const generator = await createBudgetLine(db, {
      seasonId: s26, label: 'שכירות גנרטור', quantityText: '1', quantityNum: 1,
      unitCost: 41300, total: 41300, category: 'camp',
    });
    const water = await createBudgetLine(db, {
      seasonId: s26, label: 'מים וקרח', total: 6200, category: 'camp',
    });
    await recordEntry(db, {
      occurredOn: new Date('2026-09-09T00:00:00Z'), direction: 'out', amount: 41300,
      description: 'מקדמה לגנרטור', budgetLineId: generator, seasonId: s26,
      recordedBy: 'lead@shliff.camp',
    });
    await recordEntry(db, {
      occurredOn: new Date('2026-09-02T00:00:00Z'), direction: 'out', amount: 1740,
      description: 'משלוח ראשון', budgetLineId: water, seasonId: s26,
      recordedBy: 'lead@shliff.camp',
    });

    const rows = await listBudgetLinesWithActuals(db, s26);
    const byLabel = new Map(rows.map((row) => [row.label, row]));
    expect(byLabel.get('שכירות גנרטור')!.spentAgorot).toBe(4130000);
    expect(byLabel.get('שכירות גנרטור')!.remainingAgorot).toBe(0);
    expect(byLabel.get('מים וקרח')!.spentAgorot).toBe(174000);
    expect(byLabel.get('מים וקרח')!.remainingAgorot).toBe(446000);
  });

  it('reports a line spent past its plan as over, never as negative remaining alone', async () => {
    const kitchen = await createBudgetLine(db, {
      seasonId: s26, label: 'מטבח ואוכל', total: 8400, category: 'camp',
    });
    await recordEntry(db, {
      occurredOn: new Date('2026-08-30T00:00:00Z'), direction: 'out', amount: 8720,
      description: 'קניות', budgetLineId: kitchen, recordedBy: 'lead@shliff.camp',
    });

    const [row] = await listBudgetLinesWithActuals(db, s26);
    expect(row.spentAgorot).toBe(872000);
    expect(row.overAgorot).toBe(32000);
    expect(row.remainingAgorot).toBe(0);
  });

  // R4: a season is a hand-set label on a continuous ledger. `חוב לירון סלע על
  // ברן 25` is dated June 2026. An entry pointing at this line is spend against
  // this line whatever year the lead labelled it.
  it('counts an entry against the line even when the entry carries another season', async () => {
    const shade = await createBudgetLine(db, {
      seasonId: s26, label: 'צל ומבנה', total: 18600, category: 'camp',
    });
    await recordEntry(db, {
      occurredOn: new Date('2026-06-01T00:00:00Z'), direction: 'out', amount: 11500,
      description: 'מבנה שני', budgetLineId: shade, seasonId: s25,
      recordedBy: 'lead@shliff.camp',
    });

    const [row] = await listBudgetLinesWithActuals(db, s26);
    expect(row.spentAgorot).toBe(1150000);
  });

  it('nets a refund back against the line it came from', async () => {
    const sound = await createBudgetLine(db, {
      seasonId: s26, label: 'סאונד רחבה', total: 12000, category: 'dancefloor',
    });
    await recordEntry(db, {
      occurredOn: new Date('2026-07-01T00:00:00Z'), direction: 'out', amount: 6000,
      description: 'מקדמה', budgetLineId: sound, recordedBy: 'lead@shliff.camp',
    });
    await recordEntry(db, {
      occurredOn: new Date('2026-07-20T00:00:00Z'), direction: 'in', amount: 1000,
      description: 'זיכוי על רמקול שלא סופק', budgetLineId: sound,
      recordedBy: 'lead@shliff.camp',
    });

    const [row] = await listBudgetLinesWithActuals(db, s26);
    expect(row.spentAgorot).toBe(500000);
  });

  it('carries the source cell columns through, so a row can be traced', async () => {
    await createBudgetLine(db, {
      seasonId: s26, label: 'ביטוח ואישורים', total: 3875, category: 'camp',
    });
    const [row] = await listBudgetLinesWithActuals(db, s26);
    expect(row.sourceBlockId).toBeNull();
    expect(row.sourceRow).toBeNull();
  });
});

function actualLine(overrides: Partial<BudgetLineActuals> = {}): BudgetLineActuals {
  return {
    id: 'b1', label: 'סעיף', quantityText: null, quantityNumAgorot: null,
    unitCostAgorot: null, totalAgorot: 100000, rationale: null, category: 'camp',
    arithmeticOff: false, sourceBlockId: null, sourceRow: null,
    spentAgorot: 0, remainingAgorot: 100000, overAgorot: 0,
    ...overrides,
  };
}

describe('grouping the budget', () => {
  it('subtotals each category and keeps camp before dancefloor, never by size', () => {
    const groups = groupBudgetByCategory([
      actualLine({ id: 'a', category: 'dancefloor', totalAgorot: 1200000, spentAgorot: 600000 }),
      actualLine({ id: 'b', category: 'camp', totalAgorot: 620000, spentAgorot: 174000 }),
      actualLine({ id: 'c', category: 'camp', totalAgorot: 840000, spentAgorot: 872000 }),
    ]);

    expect(groups.map((group) => group.category)).toEqual(['camp', 'dancefloor']);
    expect(groups[0].label).toBe('קאמפ');
    expect(groups[0].count).toBe(2);
    expect(groups[0].plannedAgorot).toBe(1460000);
    expect(groups[0].spentAgorot).toBe(1046000);
    expect(groups[1].label).toBe('רחבה');
    expect(groups[1].plannedAgorot).toBe(1200000);
  });

  // A zero subtotal asserts a budget of nothing. The truth is that nothing was
  // recorded, and an omitted group says that without asserting anything.
  it('omits a category with no lines rather than showing a zero subtotal', () => {
    const groups = groupBudgetByCategory([actualLine({ category: 'camp' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe('camp');
  });

  it("keeps a group's remaining as the sum of its lines' remainders, not planned minus spent", () => {
    // One line over by 320 and one under by 4,460. Netting planned against
    // spent would report 4,140 left; the truth is 4,460 left on one line and
    // an overrun on another.
    const [group] = groupBudgetByCategory([
      actualLine({ id: 'a', totalAgorot: 840000, spentAgorot: 872000, remainingAgorot: 0, overAgorot: 32000 }),
      actualLine({ id: 'b', totalAgorot: 620000, spentAgorot: 174000, remainingAgorot: 446000 }),
    ]);
    expect(group.remainingAgorot).toBe(446000);
  });

  it('totals every line across categories for the table footer', () => {
    const totals = budgetTotals([
      actualLine({ id: 'a', totalAgorot: 840000, spentAgorot: 872000, remainingAgorot: 0, overAgorot: 32000 }),
      actualLine({ id: 'b', category: 'dancefloor', totalAgorot: 1200000, spentAgorot: 600000, remainingAgorot: 600000 }),
    ]);
    expect(totals.count).toBe(2);
    expect(totals.plannedAgorot).toBe(2040000);
    expect(totals.spentAgorot).toBe(1472000);
    expect(totals.remainingAgorot).toBe(600000);
  });

  it('returns no groups at all for a season with no budget', () => {
    expect(groupBudgetByCategory([])).toEqual([]);
    expect(budgetTotals([])).toEqual({
      plannedAgorot: 0, spentAgorot: 0, remainingAgorot: 0, count: 0,
    });
  });
});
