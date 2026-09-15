import { describe, it, expect } from 'vitest';
import { isArithmeticOff } from './arithmetic';
import { toAgorot } from '@/lib/money';

describe('isArithmeticOff', () => {
  it('sub-agora rate with correct arithmetic does not flag', () => {
    // 1000 units at ₪0.335 = ₪335.00. This is the Wave 1 bug: agorot-first would
    // round 0.335 to 34 agorot, then compute 34 * 1000 = 34000 agorot = ₪340
    // (off by ₪5, past tolerance). Product-first computes 1000 * 0.335 = 335,
    // converting once to agorot = 33500 agorot = ₪335 (correct).
    expect(isArithmeticOff(1000, 0.335, toAgorot(335))).toBe(false);
  });

  it('arithmetic off by ₪0.30 (within 50-agora tolerance) does not flag', () => {
    // Off by exactly 30 agorot, within 50-agora tolerance
    expect(isArithmeticOff(100, 10, toAgorot(1000.3))).toBe(false);
  });

  it('arithmetic off by ₪0.60 (outside 50-agora tolerance) flags', () => {
    // Off by exactly 60 agorot, outside 50-agora tolerance
    expect(isArithmeticOff(100, 10, toAgorot(1000.6))).toBe(true);
  });
});
