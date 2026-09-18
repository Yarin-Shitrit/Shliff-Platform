import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { createBudgetLine, listBudgetLines, budgetTotalAgorot, budgetDerivation } from './budget';

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
