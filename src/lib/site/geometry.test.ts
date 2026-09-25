import { describe, it, expect } from 'vitest';
import {
  HANDLES, areaM2, contains, formatArea, formatMetres, formatSize, gapsAround, move, outsideIds,
  overlap, overlapPairs, resize, shadeCounts, shadeState, shadedRect, snap,
  turnAboutCentre, unionRect, wholeCm, type PlacedItem, type Rect,
} from './geometry';

const PLOT = { widthCm: 2600, depthCm: 2400 };

function item(over: Partial<PlacedItem> & { id: string }): PlacedItem {
  return { kind: 'tent', insetCm: null, x: 0, y: 0, width: 300, depth: 300, ...over };
}

describe('snapping', () => {
  it('rounds to the nearest grid line', () => {
    expect(snap(37, 50)).toBe(50);
    expect(snap(24, 50)).toBe(0);
    expect(snap(125, 50)).toBe(150);
    expect(snap(-37, 50)).toBe(-50);
  });

  it('keeps the value when there is no grid', () => {
    expect(snap(37, 0)).toBe(37);
    expect(snap(37.4, 0)).toBe(37);
  });
});

describe('containment and overlap', () => {
  it('counts an item flush against the fence as inside', () => {
    expect(contains(PLOT, { x: 2300, y: 2100, width: 300, depth: 300 })).toBe(true);
    expect(contains(PLOT, { x: 2301, y: 2100, width: 300, depth: 300 })).toBe(false);
    expect(contains(PLOT, { x: -1, y: 0, width: 300, depth: 300 })).toBe(false);
  });

  it('does not call two rectangles sharing an edge an overlap', () => {
    const a: Rect = { x: 0, y: 0, width: 200, depth: 90 };
    expect(overlap(a, { x: 200, y: 0, width: 200, depth: 90 })).toBe(false);
    expect(overlap(a, { x: 199, y: 0, width: 200, depth: 90 })).toBe(true);
    expect(overlap(a, { x: 0, y: 90, width: 200, depth: 90 })).toBe(false);
  });

  it('lists every overlapping pair once, in input order', () => {
    const items = [
      item({ id: 'a', x: 0, y: 0 }),
      item({ id: 'b', x: 100, y: 100 }),
      item({ id: 'c', x: 1000, y: 1000 }),
      item({ id: 'd', x: 1100, y: 1100 }),
    ];
    expect(overlapPairs(items)).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('never pairs a shade net with what sits under it, nor two nets', () => {
    const items = [
      item({ id: 'net', kind: 'shade', insetCm: 50, width: 800, depth: 800 }),
      item({ id: 'net2', kind: 'shade', insetCm: 50, x: 400, width: 800, depth: 800 }),
      item({ id: 'sofa', kind: 'sofa', x: 100, y: 100, width: 200, depth: 90 }),
    ];
    expect(overlapPairs(items)).toEqual([]);
  });

  it('names what the fence now cuts through', () => {
    const items = [item({ id: 'in', x: 0, y: 0 }), item({ id: 'out', x: 2500, y: 0 })];
    expect(outsideIds(items, PLOT)).toEqual(['out']);
    // Shrinking the plot moves nothing; it only changes who is outside.
    expect(outsideIds(items, { widthCm: 200, depthCm: 200 })).toEqual(['in', 'out']);
  });
});

describe('moving and resizing', () => {
  const rect: Rect = { x: 500, y: 500, width: 300, depth: 200 };

  it('moves by a snapped delta', () => {
    expect(move(rect, 37, -120, 50)).toEqual({ x: 550, y: 400, width: 300, depth: 200 });
  });

  it('keeps the opposite edge still on every handle', () => {
    expect(resize(rect, 'e', 100, 0, 50)).toEqual({ x: 500, y: 500, width: 400, depth: 200 });
    expect(resize(rect, 'w', 100, 0, 50)).toEqual({ x: 600, y: 500, width: 200, depth: 200 });
    expect(resize(rect, 's', 0, 100, 50)).toEqual({ x: 500, y: 500, width: 300, depth: 300 });
    expect(resize(rect, 'n', 0, 100, 50)).toEqual({ x: 500, y: 600, width: 300, depth: 100 });
    expect(resize(rect, 'se', 100, 100, 50)).toEqual({ x: 500, y: 500, width: 400, depth: 300 });
    expect(resize(rect, 'nw', -100, -100, 50)).toEqual({ x: 400, y: 400, width: 400, depth: 300 });
    expect(resize(rect, 'ne', 100, -100, 50)).toEqual({ x: 500, y: 400, width: 400, depth: 300 });
    expect(resize(rect, 'sw', -100, 100, 50)).toEqual({ x: 400, y: 500, width: 400, depth: 300 });
  });

  it('stops at the minimum side rather than turning inside out', () => {
    for (const handle of HANDLES) {
      const result = resize(rect, handle, -10_000, -10_000, 50);
      expect(result.width).toBeGreaterThanOrEqual(10);
      expect(result.depth).toBeGreaterThanOrEqual(10);
      const grown = resize(rect, handle, 10_000, 10_000, 50);
      expect(grown.width).toBeGreaterThanOrEqual(10);
      expect(grown.depth).toBeGreaterThanOrEqual(10);
    }
    expect(resize(rect, 'e', -10_000, 0, 50)).toEqual({ x: 500, y: 500, width: 10, depth: 200 });
    expect(resize(rect, 'w', 10_000, 0, 50)).toEqual({ x: 790, y: 500, width: 10, depth: 200 });
  });

  it('snaps the dragged edge', () => {
    expect(resize(rect, 'e', 37, 0, 50)).toEqual({ x: 500, y: 500, width: 350, depth: 200 });
  });
});

describe('shade', () => {
  const net = item({ id: 'net', kind: 'shade', insetCm: 50, x: 100, y: 100, width: 800, depth: 800 });

  it('shades (m − 1) × (n − 1) of an m × n net', () => {
    expect(shadedRect(net)).toEqual({ x: 150, y: 150, width: 700, depth: 700 });
  });

  it('shades nothing when the net is smaller than twice its strip', () => {
    expect(shadedRect(item({ id: 'tiny', kind: 'shade', insetCm: 50, width: 100, depth: 100 }))).toBeNull();
    expect(shadedRect(item({ id: 'thin', kind: 'shade', insetCm: 50, width: 800, depth: 100 }))).toBeNull();
  });

  it('treats a net with no inset as shading its whole footprint', () => {
    expect(shadedRect(item({ id: 'flat', kind: 'shade', insetCm: 0, width: 800, depth: 800 })))
      .toEqual({ x: 0, y: 0, width: 800, depth: 800 });
  });

  it('tells a sofa in the strip from one in the shade from one in the sun', () => {
    const inShade: Rect = { x: 200, y: 200, width: 200, depth: 90 };
    const inStrip: Rect = { x: 100, y: 100, width: 200, depth: 90 };
    const edge: Rect = { x: 150, y: 150, width: 700, depth: 700 };
    const inSun: Rect = { x: 1500, y: 1500, width: 200, depth: 90 };
    expect(shadeState(inShade, [net])).toBe('shaded');
    expect(shadeState(inStrip, [net])).toBe('partly');
    expect(shadeState(edge, [net])).toBe('shaded');
    expect(shadeState(inSun, [net])).toBe('unshaded');
  });

  it('counts nets, states and shaded ground', () => {
    const items = [
      net,
      item({ id: 'sofa', kind: 'sofa', x: 200, y: 200, width: 200, depth: 90 }),
      item({ id: 'chair', kind: 'armchair', x: 100, y: 100, width: 90, depth: 90 }),
      item({ id: 'tent', kind: 'tent', x: 1500, y: 1500 }),
    ];
    expect(shadeCounts(items)).toEqual({
      nets: 1, shaded: 1, partly: 1, unshaded: 1, shadedAreaM2: 49,
    });
  });
});

describe('formatting', () => {
  it('speaks metres', () => {
    expect(formatMetres(350)).toBe('3.5 מ׳');
    expect(formatMetres(300)).toBe('3 מ׳');
    expect(formatMetres(275)).toBe('2.75 מ׳');
    expect(formatSize(300, 300)).toBe('3 × 3 מ׳');
    expect(formatSize(700, 250)).toBe('7 × 2.5 מ׳');
  });

  it('measures the plot in square metres', () => {
    expect(areaM2(PLOT)).toBe(624);
    expect(areaM2({ width: 800, depth: 800 })).toBe(64);
    expect(areaM2({ width: 250, depth: 90 })).toBe(2.3);
    expect(formatArea(624)).toBe('624 מ״ר');
  });
});

describe('turning about the centre', () => {
  it('swaps the sides and keeps the middle where it was', () => {
    expect(turnAboutCentre({ x: 1000, y: 900, width: 200, depth: 90 }))
      .toEqual({ x: 1055, y: 845, width: 90, depth: 200 });
  });

  it('comes back after two turns when the sides differ by an even number', () => {
    const rect = { x: 500, y: 1200, width: 700, depth: 250 };
    expect(turnAboutCentre(turnAboutCentre(rect))).toEqual(rect);
  });

  it('stays in whole centimetres when the sides differ by an odd number', () => {
    const turned = turnAboutCentre({ x: 0, y: 0, width: 91, depth: 90 });
    expect(Number.isInteger(turned.x) && Number.isInteger(turned.y)).toBe(true);
  });

  /* Review minor: rounding the position, half up, moved the item half a
     centimetre per quarter turn when its sides differ by an odd number —
     four turns left it about 2 cm from where it began. */
  it('comes back to exactly where it started after two and after four turns, whatever the sides', () => {
    for (const rect of [
      { x: 0, y: 0, width: 91, depth: 90 },
      { x: 1000, y: 700, width: 305, depth: 200 },
      { x: 13, y: 7, width: 90, depth: 91 },
      { x: -40, y: 2500, width: 777, depth: 100 },
    ]) {
      const once = turnAboutCentre(rect);
      expect(turnAboutCentre(once)).toEqual(rect);
      expect(turnAboutCentre(turnAboutCentre(turnAboutCentre(once)))).toEqual(rect);
      // Each turn keeps the middle within half a centimetre of where it was.
      expect(Math.abs(once.x + once.width / 2 - (rect.x + rect.width / 2))).toBeLessThanOrEqual(0.5);
      expect(Math.abs(once.y + once.depth / 2 - (rect.y + rect.depth / 2))).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('union of rectangles', () => {
  it('is null for nothing', () => {
    expect(unionRect([])).toBeNull();
  });

  it('covers every rectangle', () => {
    expect(unionRect([
      { x: 100, y: 100, width: 300, depth: 300 },
      { x: 600, y: 50, width: 100, depth: 500 },
    ])).toEqual({ x: 100, y: 50, width: 600, depth: 500 });
  });
});

describe('whole centimetres', () => {
  it('rounds to the nearest whole centimetre', () => {
    expect(wholeCm(350.4)).toBe(350);
    expect(wholeCm(350.6)).toBe(351);
  });

  it('never returns negative zero', () => {
    expect(wholeCm(-0.4)).toBe(0);
    expect(Object.is(wholeCm(-0.4), 0)).toBe(true);
  });
});

describe('gaps around an item', () => {
  const plot = { widthCm: 2600, depthCm: 2400 };

  it('measures to the nearest neighbour on each side, and to the fence', () => {
    const tent = { x: 500, y: 900, width: 300, depth: 300 };
    const others = [
      { x: 900, y: 1000, width: 200, depth: 90 }, // east, 100 away, overlaps tent's rows
      { x: 150, y: 900, width: 300, depth: 300 }, // west, 50 away
    ];
    // South is 1200 to the fence and north 900 — both past six metres, so left out.
    expect(gapsAround(tent, others, plot)).toEqual([
      { from: [800, 1050], to: [900, 1050], lengthCm: 100 },
      { from: [450, 1050], to: [500, 1050], lengthCm: 50 },
    ]);
  });

  it('leaves out anything six metres or further, and touching sides', () => {
    const rect = { x: 0, y: 0, width: 100, depth: 100 };
    expect(gapsAround(rect, [{ x: 100, y: 0, width: 50, depth: 50 }], plot)).toEqual([]);
  });

  it('rounds gap coordinates to whole centimetres with odd-sized rectangles', () => {
    const rect = { x: 500, y: 900, width: 91, depth: 91 };
    const others = [{ x: 700, y: 900, width: 100, depth: 100 }];
    expect(gapsAround(rect, others, plot)).toEqual([
      { from: [591, 946], to: [700, 946], lengthCm: 109 },
      { from: [0, 946], to: [500, 946], lengthCm: 500 },
    ]);
  });
});
