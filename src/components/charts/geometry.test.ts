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
    // These two identities above are algebraic — true of the rtl formula at
    // *any* scale, including a bar drawn at a tenth of its true length (a
    // `× scale` factor injected into the ratio still satisfies both). Only a
    // pinned actual width, computed independently
    // (4200000/6437530×400 - 2 and 2237530/6437530×400 - 2), can catch that.
    expect(segments[0].width).toBeCloseTo(258.96965761712954, 6);
    expect(segments[1].width).toBeCloseTo(137.03034238287043, 6);
  });

  /**
   * `money/page.tsx` passes exactly `[duesCoverAgorot, fundingTargetAgorot]`
   * against `budgetTotalAgorot` — and a funding target set before a budget
   * cut makes that sum exceed the budget in ordinary operation. Before the
   * fix, the cumulative offset (never itself clamped, unlike each segment's
   * own ratio) ran past `width`, drawing this exact case's second segment at
   * `x: -173.22...` — outside the track. Every box must stay within it.
   */
  it('keeps every segment inside the track when segments sum past the total', () => {
    const rtl = stackGeometry({
      segmentsAgorot: [4200000, 4000000], totalAgorot: 6437530,
      width: 640, direction: 'rtl', gap: 2,
    });
    for (const box of rtl) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(640 + 1e-6);
    }
    // Pinned, not just bounded — a fix that clamped by simply dropping the
    // overrunning segment entirely, or by re-normalising every ratio to sum
    // to 1, would also satisfy the bounds check above while drawing
    // different boxes than the one this fix actually produces.
    expect(rtl[0].x).toBeCloseTo(224.44854781259272, 6);
    expect(rtl[0].width).toBeCloseTo(415.5514521874073, 6);
    expect(rtl[1].x).toBeCloseTo(0, 6);
    expect(rtl[1].width).toBeCloseTo(222.44854781259272, 6);

    const ltr = stackGeometry({
      segmentsAgorot: [4200000, 4000000], totalAgorot: 6437530,
      width: 640, direction: 'ltr', gap: 2,
    });
    for (const box of ltr) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(640 + 1e-6);
    }
    expect(ltr[1].x + ltr[1].width).toBeCloseTo(640, 6);
  });

  /**
   * Deferred minor #5, resolved deliberately rather than left standing: a
   * segment narrower than the gap renders at zero width (100 of 10,000 here
   * — 3px of a 300px track, less than the 5px gap), but the offset still
   * advances by its full un-gapped share. The alternative — collapsing
   * offset for a zero-width sliver — would shift every later segment left by
   * the sliver's true proportional territory, understating where it sits.
   * These are pinned end-to-end so a change to either choice fails here
   * rather than only being noticed on the money page.
   */
  it('keeps a sliver segment consuming its full proportional offset even though it renders zero-width', () => {
    const segments = stackGeometry({
      segmentsAgorot: [9700, 100, 200], totalAgorot: 10000,
      width: 300, direction: 'rtl', gap: 5,
    });
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ x: 14, width: 286 });
    // The sliver: rendered width is exactly zero, not merely small.
    expect(segments[1]).toEqual({ x: 9, width: 0 });
    // The third segment's position already reflects the sliver's full
    // 3px (100/10000 × 300) of consumed offset, not zero.
    expect(segments[2]).toEqual({ x: 5, width: 1 });
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
