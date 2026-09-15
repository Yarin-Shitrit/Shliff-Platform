import { describe, it, expect } from 'vitest';
import type { BlockRow } from './rows';
import type { PromoteContext } from './types';
import { obligationRow } from './obligations';

const CTX: PromoteContext = {
  seasonId: 'season-25', recordedBy: 'lead@shliff.test', blockId: 'block-4',
};

function row(cells: Record<string, string>, sheetRow = 12): BlockRow {
  return { sheetRow, cells, raw: Object.values(cells) };
}

describe('obligationRow', () => {
  it('reads a debt the camp owes, with its party kept as raw text', () => {
    const out = obligationRow(row({
      party: 'יוסף', description: 'חוב יוסף', amount: '15240', date: '20/05/2025',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.direction).toBe('camp_owes');
    expect(out.input.amount).toBe(15240);
    expect(out.input.description).toBe('חוב יוסף');
    expect(out.partyRaw).toBe('יוסף');
    expect(out.input.partyPersonId).toBeUndefined();
    expect(out.input.seasonId).toBe('season-25');
  });

  it('keeps a nameless reimbursement as an obligation with no party, flagged', () => {
    const out = obligationRow(row({
      party: '', description: 'החזר הוצאות', amount: '480', date: '20/05/2025',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.partyRaw).toBeNull();
    expect(out.input.partyName).toBeUndefined();
    expect(out.notes.join(' ')).toMatch(/בלי שם/);
  });

  it('treats a party of only invisible marks as no party at all', () => {
    const out = obligationRow(row({
      party: '‏', description: 'החזר הוצאות', amount: '480', date: '20/05/2025',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.partyRaw).toBeNull();
    expect(out.notes.join(' ')).toMatch(/בלי שם/);
  });

  it('promotes with a null season when the sheet has none', () => {
    const out = obligationRow(row({
      party: 'יוסף', description: 'חוב יוסף', amount: '15240', date: '20/05/2025',
    }), { ...CTX, seasonId: null });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.seasonId).toBeUndefined();
  });

  it('refuses a סה"כ row', () => {
    const out = obligationRow(row({
      party: '', description: 'סה"כ', amount: '5954', date: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('total-row');
  });

  it('refuses a row with no amount', () => {
    const out = obligationRow(row({
      party: 'יוסף', description: 'חוב יוסף', amount: '', date: '20/05/2025',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-amount');
  });

  it('refuses a row with no readable date', () => {
    const out = obligationRow(row({
      party: 'יוסף', description: 'חוב יוסף', amount: '15240', date: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-date');
  });

  it('refuses a row with no description', () => {
    const out = obligationRow(row({
      party: 'יוסף', description: '', amount: '15240', date: '20/05/2025',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-description');
  });

  it('refuses a negative amount, which may indicate opposite direction', () => {
    const out = obligationRow(row({
      party: 'יוסף', description: 'חוב יוסף', amount: '-15240', date: '20/05/2025',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('negative-amount');
  });

  it('refuses a placeholder dash, which is treated as no amount', () => {
    const out = obligationRow(row({
      party: 'יוסף', description: 'חוב יוסף', amount: '-', date: '20/05/2025',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-amount');
  });
});
