import { describe, it, expect } from 'vitest';
import { needsReview, blockState, PROMOTABLE_ARCHETYPES } from './register';

const base = {
  archetype: 'ledger' as const,
  confidence: 1,
  mappingSource: 'admin',
  columnMap: [{ column: 1, field: 'date', confidence: 1 }],
  confirmedAt: new Date('2026-09-12T10:00:00Z'),
  promotedRows: 0,
  sheetState: 'eligible' as const,
};

describe('needsReview', () => {
  it('sends a rules-mapped block below the threshold to a human', () => {
    expect(needsReview(0.3, 'rules', [{ column: 1, field: 'date', confidence: 1 }])).toBe(true);
  });

  it('sends a rules-mapped block with no columns to a human, however confident', () => {
    expect(needsReview(0.95, 'rules', [])).toBe(true);
  });

  it('leaves a signature-recognised block alone even with an empty map', () => {
    expect(needsReview(1, 'signature', [])).toBe(false);
  });
});

describe('blockState precedence', () => {
  it('calls a non-authoritative copy superseded before anything else', () => {
    expect(blockState({ ...base, sheetState: 'superseded', promotedRows: 9 }))
      .toBe('superseded');
  });

  it('calls a block on an undecided sheet blocked, even when confirmed', () => {
    expect(blockState({ ...base, sheetState: 'undecided' })).toBe('blocked');
    expect(blockState({ ...base, sheetState: 'ambiguous' })).toBe('blocked');
  });

  it('calls an archetype with no promoter no-promoter, even when confirmed', () => {
    expect(blockState({ ...base, archetype: 'income_channels' })).toBe('no-promoter');
  });

  it('calls a block with rows in the database promoted', () => {
    expect(blockState({ ...base, promotedRows: 52 })).toBe('promoted');
  });

  it('calls a confirmed block with no rows yet confirmed', () => {
    expect(blockState(base)).toBe('confirmed');
  });

  it('calls an unconfirmed block that needs a human needs-review', () => {
    expect(blockState({
      ...base, confirmedAt: null, confidence: 0.3, mappingSource: 'rules',
    })).toBe('needs-review');
  });

  it('calls an unconfirmed, well-mapped block recognised', () => {
    expect(blockState({ ...base, confirmedAt: null })).toBe('recognised');
  });

  it('lists exactly the four archetypes Wave 2 promotes', () => {
    expect([...PROMOTABLE_ARCHETYPES].sort())
      .toEqual(['budget_lines', 'ledger', 'obligations', 'ticket_rounds']);
  });
});
