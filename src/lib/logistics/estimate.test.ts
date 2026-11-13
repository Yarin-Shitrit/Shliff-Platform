import { describe, it, expect } from 'vitest';
import { rowEstimateAgorot, typedEstimate } from './estimate';

describe('what a purchase row is expected to cost', () => {
  it('is the price of one times how many', () => {
    expect(rowEstimateAgorot(15000, 12)).toBe(180000);
  });

  it('stays unpriced when nobody priced it, whatever the count', () => {
    // Null times twelve is not zero: a zero would claim the camp expects
    // twelve of them for free.
    expect(rowEstimateAgorot(null, 12)).toBeNull();
  });

  it('keeps a real zero a zero', () => {
    expect(rowEstimateAgorot(0, 12)).toBe(0);
  });
});

describe('the product shown while a lead types', () => {
  it('multiplies the two boxes', () => {
    expect(typedEstimate('150', '12')).toEqual({ quantity: 12, unitAgorot: 15000, totalAgorot: 180000 });
  });

  it('works in agorot, so a price with decimals does not drift', () => {
    // 0.1 + 0.2 territory: 19.99 × 3 as floats is 59.97000000000001.
    expect(typedEstimate('19.99', '3')?.totalAgorot).toBe(5997);
  });

  it('shows nothing while the price is empty or not a number', () => {
    expect(typedEstimate('', '12')).toBeNull();
    expect(typedEstimate('  ', '12')).toBeNull();
    expect(typedEstimate('abc', '12')).toBeNull();
    expect(typedEstimate('-5', '12')).toBeNull();
  });

  it('shows nothing while the count is not a whole number, one or more', () => {
    expect(typedEstimate('150', '')).toBeNull();
    expect(typedEstimate('150', '0')).toBeNull();
    expect(typedEstimate('150', '1.5')).toBeNull();
  });
});
