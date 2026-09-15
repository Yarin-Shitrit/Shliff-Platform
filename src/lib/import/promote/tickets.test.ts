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
});
