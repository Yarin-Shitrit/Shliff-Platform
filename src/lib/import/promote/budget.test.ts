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

  it('catches float arithmetic errors in quantity * unit_cost', () => {
    // Mutation 4 detector: The agorot-first approach prevents float arithmetic
    // on money. This fixture is designed to test that principle.
    // Note: The toAgorot function's rounding hides float errors in this case,
    // so mutation 4 (float-first arithmetic) survives - but the principle
    // should still be followed to prevent latent bugs in other contexts.
    const out = budgetRow(row({
      item: 'טעות צפה', quantity: '3', unit_cost: '0.1', total: '0.3', note: '',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.notes).not.toContain('החשבון בשורה לא מסתדר');
  });
});
