import { describe, it, expect } from 'vitest';
import { endpointRefusal, geometricMedian, joins, splits } from './lines';

describe('a splitter', () => {
  it('carries either utility, and is where a split may start', () => {
    expect(joins('water', 'splitter')).toBe(true);
    expect(joins('power', 'splitter')).toBe(true);
    expect(splits('water', 'water')).toBe(true);
    expect(splits('water', 'splitter')).toBe(true);
    expect(splits('water', 'shower')).toBe(false);
    expect(splits('power', 'fridge')).toBe(false);
    expect(endpointRefusal('water', 'water', 'splitter', false)).toBeNull();
    expect(endpointRefusal('power', 'splitter', 'light', false)).toBeNull();
    expect(endpointRefusal('water', 'splitter', 'toilet', false)).toMatch(/^a water pipe joins only/);
  });
});

describe('where the runs add up shortest', () => {
  it('is the middle of two points and the centre of a square', () => {
    expect(geometricMedian([[0, 0], [1000, 0]])).toEqual([500, 0]);
    expect(geometricMedian([[0, 0], [1000, 0], [1000, 1000], [0, 1000]])).toEqual([500, 500]);
  });

  it('is the Fermat point of a triangle, within a centimetre', () => {
    // An equilateral triangle of side 1000: the Fermat point is its centroid, (500, 288.7).
    const [x, y] = geometricMedian([[0, 0], [1000, 0], [500, 866]]);
    expect(Math.abs(x - 500)).toBeLessThanOrEqual(1);
    expect(Math.abs(y - 289)).toBeLessThanOrEqual(1);
  });

  it('is the point itself when one point dominates, and never NaN', () => {
    expect(geometricMedian([[300, 300], [300, 300], [900, 100]])).toEqual([300, 300]);
    expect(geometricMedian([[7, 7]])).toEqual([7, 7]);
    expect(geometricMedian([])).toEqual([0, 0]);
  });
});
