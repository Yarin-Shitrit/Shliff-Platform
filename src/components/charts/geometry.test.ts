import { describe, it, expect } from 'vitest';
import { barGeometry, stackGeometry, linePoints, textAnchorFor } from './geometry';

/**
 * SVG has no logical properties. In Hebrew a horizontal bar must grow from
 * the right — the inline-start edge — and every anchor mirrors with it. Every
 * one of these assertions was a real defect class in this codebase's CSS
 * before logical properties were adopted; SVG reintroduces it.
 */
describe('chart geometry in RTL', () => {
  it('grows a bar leftward from the right edge', () => {
    const bar = barGeometry({ valueAgorot: 2500, maxAgorot: 10000, width: 400, direction: 'rtl' });
    expect(bar.width).toBe(100);
    expect(bar.x).toBe(300);
  });

  it('grows a bar rightward from zero in LTR', () => {
    const bar = barGeometry({ valueAgorot: 2500, maxAgorot: 10000, width: 400, direction: 'ltr' });
    expect(bar.width).toBe(100);
    expect(bar.x).toBe(0);
  });

  it('gives a zero-valued bar no width and still places it on the start edge', () => {
    expect(barGeometry({ valueAgorot: 0, maxAgorot: 10000, width: 400, direction: 'rtl' }))
      .toEqual({ x: 400, width: 0 });
  });

  it('never divides by a zero maximum', () => {
    expect(barGeometry({ valueAgorot: 500, maxAgorot: 0, width: 400, direction: 'rtl' }))
      .toEqual({ x: 400, width: 0 });
  });

  it('lays stacked segments from the start edge with a 2px surface gap', () => {
    const segments = stackGeometry({
      segmentsAgorot: [4200000, 2237530], totalAgorot: 6437530,
      width: 400, direction: 'rtl', gap: 2,
    });
    expect(segments).toHaveLength(2);
    // first segment hugs the right edge. toBeCloseTo, not toBe: these are
    // floats, and 400 - w + w is not reliably 400.
    expect(segments[0].x + segments[0].width).toBeCloseTo(400, 6);
    // second sits to its left, separated by the gap
    expect(segments[0].x - (segments[1].x + segments[1].width)).toBeCloseTo(2, 6);
  });

  it('mirrors line points so time runs right to left', () => {
    const points = linePoints({ values: [0, 50, 100], width: 200, height: 50, direction: 'rtl' });
    expect(points[0].x).toBe(200);
    expect(points[2].x).toBe(0);
    // y is inverted: the largest value sits at the top
    expect(points[2].y).toBe(0);
    expect(points[0].y).toBe(50);
  });

  it('anchors text to the correct edge per direction', () => {
    expect(textAnchorFor('rtl')).toBe('end');
    expect(textAnchorFor('ltr')).toBe('start');
  });
});
