import { describe, it, expect } from 'vitest';
import type { BlockRow } from './rows';
import type { PromoteContext } from './types';
import { budgetRow } from './budget';

const CTX: PromoteContext = {
  seasonId: 'season-26', recordedBy: 'lead@shliff.test', blockId: 'block-2',
};

function row(cells: Record<string, string>, sheetRow = 4): BlockRow {
  return { sheetRow, cells, raw: Object.values(cells) };
}

describe('budgetRow', () => {
  it('keeps a quantity with a unit exactly as written and derives no number from prose', () => {
    const out = budgetRow(row({
      item: 'חשמל לקאמפ', quantity: '12,000kw', unit_cost: '7500', total: '7500', note: '',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.quantityText).toBe('12,000kw');
    expect(out.input.quantityNum).toBe(12000);
    expect(out.input.total).toBe(7500);
    expect(out.input.category).toBe('camp');
  });

  it('keeps a prose quantity as text with no number at all', () => {
    const out = budgetRow(row({
      item: 'אוכל', quantity: 'תפריט שלם לשבוע', unit_cost: '', total: '5000', note: '',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.quantityText).toBe('תפריט שלם לשבוע');
    expect(out.input.quantityNum).toBeUndefined();
  });

  it('carries the why column into rationale', () => {
    const out = budgetRow(row({
      item: 'הפתעות', quantity: '', unit_cost: '', total: '5852.3',
      note: 'תוספת של 1,000 שקלים - לחיזוק',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.rationale).toBe('תוספת של 1,000 שקלים - לחיזוק');
  });

  it('notes an arithmetic mismatch without refusing the row', () => {
    const out = budgetRow(row({
      item: 'שירותים נסורת', quantity: '5', unit_cost: '125', total: '1625', note: '',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.total).toBe(1625);
    expect(out.notes.join(' ')).toMatch(/חשבון/);
  });

  it('refuses every row when the sheet has no season', () => {
    const out = budgetRow(row({
      item: 'חשמל לקאמפ', quantity: '', unit_cost: '', total: '7500', note: '',
    }), { ...CTX, seasonId: null });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-season');
  });

  it('refuses a סה"כ row', () => {
    const out = budgetRow(row({
      item: 'סה"כ', quantity: '', unit_cost: '', total: '64375.3', note: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('total-row');
  });

  it('refuses a row with no total', () => {
    const out = budgetRow(row({
      item: 'חשמל לקאמפ', quantity: '', unit_cost: '', total: '', note: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-amount');
  });

  it('refuses a label of only invisible marks', () => {
    const out = budgetRow(row({
      item: '‏', quantity: '', unit_cost: '', total: '7500', note: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-label');
  });

  it('sub-agora unit cost with correct arithmetic produces no note', () => {
    // 1000 units at ₪0.335 = ₪335.00. Rounding the rate to agorot first
    // would give ₪340 (error of ₪5), proving that rates must multiply first.
    const out = budgetRow(row({
      item: 'דוגמה של שער תת-אגורה', quantity: '1000', unit_cost: '0.335', total: '335', note: '',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.notes).toEqual([]);
  });

  it('sub-agora unit cost with genuinely wrong arithmetic still flags', () => {
    // Same rate and quantity, but stated total is ₪400 instead of ₪335.
    // The check must not be satisfied by simply never flagging anything.
    const out = budgetRow(row({
      item: 'טעות אמיתית', quantity: '1000', unit_cost: '0.335', total: '400', note: '',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.notes).toContain('החשבון בשורה לא מסתדר: כמות × מחיר ליחידה שונה מהעלות הכוללת');
  });
});
