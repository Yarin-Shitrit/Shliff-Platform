import { describe, it, expect } from 'vitest';
import { PIPELINE_VERSION } from '@/lib/version';

describe('pipeline version', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(PIPELINE_VERSION)).toBe(true);
    expect(PIPELINE_VERSION).toBeGreaterThan(0);
  });
});
