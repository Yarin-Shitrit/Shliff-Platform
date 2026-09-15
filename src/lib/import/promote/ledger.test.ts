import { describe, it, expect } from 'vitest';
import type { BlockRow } from './rows';
import type { PromoteContext } from './types';
import { ledgerRow } from './ledger';

const CTX: PromoteContext = {
  seasonId: 'season-26', recordedBy: 'lead@shliff.test', blockId: 'block-1',
};

function row(cells: Record<string, string>, sheetRow = 7): BlockRow {
  return { sheetRow, cells, raw: Object.values(cells) };
}

describe('ledgerRow', () => {
  it('reads an outflow as direction out with a positive amount', () => {
    const out = ledgerRow(row({
      date: '20/05/2025', description: 'מקדמה מייצג', outflow: '4,000', inflow: '',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.direction).toBe('out');
    expect(out.input.amount).toBe(4000);
    expect(out.input.description).toBe('מקדמה מייצג');
    expect(out.input.occurredOn).toEqual(new Date(Date.UTC(2025, 4, 20)));
    expect(out.input.seasonId).toBe('season-26');
    expect(out.input.sourceBlockId).toBe('block-1');
    expect(out.input.sourceRow).toBe(7);
  });

  it('reads an inflow as direction in', () => {
    const out = ledgerRow(row({
      date: '2025-10-30', description: 'מסיבת פקאנים', outflow: '', inflow: '57000',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.direction).toBe('in');
    expect(out.input.amount).toBe(57000);
  });

  it('never attributes an account, an event or a budget line', () => {
    const out = ledgerRow(row({
      date: '2025-10-30', description: 'מסיבת פקאנים', outflow: '', inflow: '57000',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.accountId).toBeUndefined();
    expect(out.input.eventId).toBeUndefined();
    expect(out.input.budgetLineId).toBeUndefined();
  });

  it('promotes with a null season when the sheet has none', () => {
    const out = ledgerRow(row({
      date: '2025-10-30', description: 'מסיבת פקאנים', outflow: '', inflow: '57000',
    }), { ...CTX, seasonId: null });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.seasonId).toBeUndefined();
  });

  it('refuses the carry-forward line', () => {
    const out = ledgerRow(row({
      date: '', description: 'מעבר לקובץ חדש', outflow: '', inflow: '44647',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('carry-forward');
  });

  it('refuses a סה"כ row', () => {
    const out = ledgerRow(row({
      date: '', description: 'סה"כ', outflow: '45271', inflow: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('total-row');
  });

  it('refuses a row carrying both an outflow and an inflow', () => {
    const out = ledgerRow(row({
      date: '20/05/2025', description: 'לא ברור', outflow: '100', inflow: '200',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('both-directions');
  });

  it('refuses a row with no amount in either column', () => {
    const out = ledgerRow(row({
      date: '20/05/2025', description: 'כותרת ביניים', outflow: '', inflow: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-amount');
  });

  it('refuses an unparseable date rather than inventing one', () => {
    const out = ledgerRow(row({
      date: 'מאי', description: 'מקדמה מייצג', outflow: '4000', inflow: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-date');
  });

  it('refuses a description of only invisible marks', () => {
    const out = ledgerRow(row({
      date: '20/05/2025', description: '‏', outflow: '4000', inflow: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-description');
  });

  it('keeps the cells of a refused row as evidence', () => {
    const out = ledgerRow(row({
      date: '', description: 'סה"כ', outflow: '45271', inflow: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.cells).toContain('סה"כ');
    expect(out.refusal.sheetRow).toBe(7);
  });
});
