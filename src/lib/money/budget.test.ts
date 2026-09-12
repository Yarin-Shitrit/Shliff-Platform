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
});
