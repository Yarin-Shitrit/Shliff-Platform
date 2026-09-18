import { describe, it, expect } from 'vitest';
import { BLOCK_ARCHETYPES } from './types';
import { FIELD_TERMS } from './map-columns';
import { FIELD_LABELS, fieldLabel, confidenceWord, NOT_IMPORTED } from './field-labels';

describe('fieldLabel', () => {
  it('names a ledger date in Hebrew rather than as `date`', () => {
    expect(fieldLabel('ledger', 'date')).toBe('תאריך התנועה');
  });

  it('distinguishes the two ledger amount columns by direction', () => {
    expect(fieldLabel('ledger', 'outflow')).toBe('סכום — יצא');
    expect(fieldLabel('ledger', 'inflow')).toBe('סכום — נכנס');
  });

  it('reads an unmapped column as not imported', () => {
    expect(fieldLabel('ledger', null)).toBe(NOT_IMPORTED);
    expect(NOT_IMPORTED).toBe('לא מיובא');
  });

  it('falls back to the identifier rather than throwing on an unknown field', () => {
    expect(fieldLabel('ledger', 'nonesuch')).toBe('nonesuch');
  });
});

describe('confidenceWord', () => {
  it('calls an exact header match בטוח', () => {
    expect(confidenceWord(1)).toBe('בטוח');
  });

  it('calls mapColumns’ partial match כנראה', () => {
    expect(confidenceWord(0.8)).toBe('כנראה');
  });

  it('puts the boundary at the threshold the pipeline already uses', () => {
    expect(confidenceWord(0.5)).toBe('כנראה');
    expect(confidenceWord(0.49)).toBe('לא בטוח');
  });

  it('calls an unmapped column לא בטוח rather than crashing on null', () => {
    expect(confidenceWord(null)).toBe('לא בטוח');
  });

  it('never returns a percentage', () => {
    for (const value of [0, 0.31, 0.63, 0.8, 1]) {
      expect(confidenceWord(value)).toMatch(/^(בטוח|כנראה|לא בטוח)$/);
    }
  });
});

describe('FIELD_LABELS covers the classifier', () => {
  it('names every archetype', () => {
    expect(Object.keys(FIELD_LABELS).sort()).toEqual([...BLOCK_ARCHETYPES].sort());
  });

  it('names every field mapColumns can produce', () => {
    for (const archetype of BLOCK_ARCHETYPES) {
      for (const field of Object.keys(FIELD_TERMS[archetype] ?? {})) {
        expect(FIELD_LABELS[archetype][field]).toBeTypeOf('string');
      }
    }
  });
});
