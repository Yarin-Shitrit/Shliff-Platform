import { describe, it, expect } from 'vitest';
import type { BlockRow } from './rows';
import type { PromoteContext } from './types';
import { ticketRow } from './tickets';

const CTX: PromoteContext = {
  seasonId: 'season-26', recordedBy: 'lead@shliff.test', blockId: 'block-3',
};

function row(cells: Record<string, string>, sheetRow = 3): BlockRow {
  return { sheetRow, cells, raw: Object.values(cells) };
}

describe('ticketRow', () => {
  it('reads a round with quantity, price and total', () => {
    const out = ticketRow(row({
      round: 'ארלי בירד', quantity: '150', price: '90', total: '13500',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.label).toBe('ארלי בירד');
    expect(out.input.quantity).toBe(150);
    expect(out.input.price).toBe(90);
    expect(out.input.total).toBe(13500);
    expect(out.input.seasonId).toBe('season-26');
    expect(out.input.sourceRow).toBe(3);
    expect(out.input.sold).toBeUndefined();
  });

  it('never links a round to an event', () => {
    const out = ticketRow(row({
      round: 'ארלי בירד', quantity: '150', price: '90', total: '13500',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.eventId).toBeUndefined();
  });

  it('keeps a round whose quantity is not a number', () => {
    const out = ticketRow(row({
      round: 'כרטיסי חבר', quantity: 'לא ידוע', price: '', total: '4000',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.quantity).toBeUndefined();
    expect(out.input.total).toBe(4000);
  });

  it('refuses when the sheet has no season', () => {
    const out = ticketRow(row({
      round: 'ארלי בירד', quantity: '150', price: '90', total: '13500',
    }), { ...CTX, seasonId: null });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-season');
  });

  it('refuses a סה"כ row', () => {
    const out = ticketRow(row({
      round: 'סה"כ', quantity: '', price: '', total: '171000',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('total-row');
  });

  it('refuses a row with no total', () => {
    const out = ticketRow(row({
      round: 'ארלי בירד', quantity: '150', price: '90', total: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-amount');
  });

  it('refuses a label of only invisible marks', () => {
    const out = ticketRow(row({
      round: '‏', quantity: '', price: '', total: '4000',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-label');
  });

  /**
   * The exact row from our own committed evidence transcript
   * (`2026-09-15-cutover-evidence-run.txt:593`). `SuperNature 3.10`'s bottom
   * bound overran its `סה״כ` into the profit-split table below it, and this
   * row of that table was promoted with ZERO refusals: `אסף` as a round label,
   * `0.3333333333` silently rounded to a quantity of 0, `0.6666666667` as a
   * ₪0.67 total. Nothing in the workbook states such a round.
   */
  it('refuses the fabricated profit-split row from the evidence run', () => {
    const out = ticketRow(row({
      round: 'אסף', quantity: '0.3333333333', price: 'שליף', total: '0.6666666667',
    }, 11), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('out-of-range');
    expect(out.refusal.sheetRow).toBe(11);
    // The value a lead has to go and look at, verbatim from the cell.
    expect(out.refusal.message).toContain('0.3333333333');
    expect(out.refusal.message).toContain('כמות');
  });

  it('refuses any fractional quantity rather than rounding it', () => {
    const out = ticketRow(row({
      round: 'סבב ג׳', quantity: '2.5', price: '100', total: '250',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('out-of-range');
    expect(out.refusal.message).toContain('2.5');
  });

  it('refuses a fraction that would have rounded to a plausible count', () => {
    // `Math.round(149.6)` is 150, so the old code wrote a count the sheet does
    // not state and nothing downstream could tell it from a real 150.
    const out = ticketRow(row({
      round: 'ארלי בירד', quantity: '149.6', price: '90', total: '13464',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('out-of-range');
  });

  it('keeps a whole quantity exactly as the sheet states it', () => {
    const out = ticketRow(row({
      round: 'סבב ד׳', quantity: '390', price: '200', total: '78000',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.quantity).toBe(390);
    expect(out.notes).toEqual([]);
  });

  /**
   * I5. `budgetRow` has reconciled quantity × unit against the stated total
   * since W20; `ticketRow` returned `notes: []` unconditionally. That
   * asymmetry is why the `אסף` row was found by a human reading all 93
   * would-write lines instead of by the run. Flagged, never blocked — the
   * camp's arithmetic is not ours to correct.
   */
  it('notes a round whose quantity × price does not equal its total', () => {
    const out = ticketRow(row({
      round: 'סבב ב׳', quantity: '100', price: '200', total: '38500',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.notes).toEqual(['החשבון בשורה לא מסתדר: כמות × מחיר שונה מהסה״כ']);
    // Noted, not refused: the row is still written with what the sheet says.
    expect(out.input.total).toBe(38500);
    expect(out.input.quantity).toBe(100);
  });

  it('does not note a round whose arithmetic closes', () => {
    const out = ticketRow(row({
      round: 'סבב ג׳', quantity: '165', price: '200.5', total: '33082.5',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.notes).toEqual([]);
  });

  it('cannot reconcile a round with no price, and says nothing rather than guessing', () => {
    const out = ticketRow(row({
      round: 'כרטיסי חבר', quantity: '40', price: '', total: '4000',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.notes).toEqual([]);
  });

  it('cannot reconcile a round with no quantity either', () => {
    const out = ticketRow(row({
      round: 'כרטיסי חבר', quantity: 'לא ידוע', price: '100', total: '4000',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.quantity).toBeUndefined();
    expect(out.notes).toEqual([]);
  });

  /** The season check still comes first, so the register shows one reason for
   *  a season-less sheet rather than a fraction complaint on every row. */
  it('refuses a fractional quantity on a season-less sheet for the season, not the fraction', () => {
    const out = ticketRow(row({
      round: 'אסף', quantity: '0.3333333333', price: 'שליף', total: '0.6666666667',
    }), { ...CTX, seasonId: null });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-season');
  });
});
