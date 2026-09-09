import { describe, it, expect } from 'vitest';
import { colLabel } from '@/lib/xlsx/col-label';

describe('colLabel', () => {
  it('labels the first alphabet', () => {
    expect(colLabel(1)).toBe('A');
    expect(colLabel(2)).toBe('B');
    expect(colLabel(25)).toBe('Y');
    expect(colLabel(26)).toBe('Z');
  });

  /**
   * The A→Z→AA boundary is where a plain base-26 conversion goes wrong: with
   * no zero digit, 26 must stay a single Z and 27 must roll to AA, not to `@A`
   * or `BA`.
   */
  it('rolls over from Z to AA rather than to a second-digit zero', () => {
    expect(colLabel(26)).toBe('Z');
    expect(colLabel(27)).toBe('AA');
    expect(colLabel(28)).toBe('AB');
  });

  it('carries through the higher boundaries', () => {
    expect(colLabel(52)).toBe('AZ');
    expect(colLabel(53)).toBe('BA');
    expect(colLabel(702)).toBe('ZZ');
    expect(colLabel(703)).toBe('AAA');
  });

  it('has no label below the first column', () => {
    expect(colLabel(0)).toBe('');
    expect(colLabel(-1)).toBe('');
  });
});
