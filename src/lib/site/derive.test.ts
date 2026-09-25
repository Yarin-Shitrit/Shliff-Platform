import { describe, it, expect } from 'vitest';
import type { KindDefaults } from './defaults';
import { derive, ropeCmOf, toPlaced, type ItemShape } from './derive';

/* This file's own fixture: an 8 × 8 m net with a 50 cm strip, on its kind's height unless told otherwise. */
function shape(over: Partial<ItemShape> & { id: string }): ItemShape {
  return {
    kind: 'shade', xCm: 500, yCm: 500, widthCm: 800, depthCm: 800, insetCm: 50,
    heightCm: null, ropeAngleDeg: null, ...over,
  };
}

/** The camp's default for nets: the preset's size and 3 m height, with this rope angle. */
function campAt(angle: number | null, heightCm = 300): KindDefaults {
  return { shade: { widthCm: 800, depthCm: 800, heightCm, insetCm: 50, ropeAngleDeg: angle } };
}

describe('a net’s ropes, placed', () => {
  it('reach out height ÷ tan angle: 3 m at 45° is 3 m', () => {
    expect(toPlaced(shape({ id: 'n', ropeAngleDeg: 45 })).ropeCm).toBe(300);
  });

  it('take the net’s own height and angle before the camp’s', () => {
    expect(ropeCmOf(shape({ id: 'n', heightCm: 400, ropeAngleDeg: 45 }), campAt(20))).toBe(400);
    expect(ropeCmOf(shape({ id: 'n', heightCm: 400 }), campAt(20))).toBe(1099);
    expect(ropeCmOf(shape({ id: 'n', ropeAngleDeg: 80 }), campAt(20))).toBe(53);
  });

  it('take the kind’s height from the camp’s own default when it has one (D18)', () => {
    expect(ropeCmOf(shape({ id: 'n' }), campAt(45, 400))).toBe(400);
  });

  it('are nothing until an angle is set somewhere (D16)', () => {
    expect(ropeCmOf(shape({ id: 'n' }), {})).toBe(0);
    expect(ropeCmOf(shape({ id: 'n' }), campAt(null))).toBe(0);
    expect(toPlaced(shape({ id: 'n' })).ropeCm).toBe(0);
  });

  it('are never anything else’s, whatever it carries', () => {
    expect(ropeCmOf(shape({ id: 't', kind: 'tent', insetCm: null, ropeAngleDeg: 45 }), campAt(45))).toBe(0);
  });
});

describe('the flags, with ropes', () => {
  const PLOT = { widthCm: 2600, depthCm: 2400, gridCm: 50 };
  // Flush with the east fence by its cloth (1800 + 800 = 2600).
  const net = shape({ id: 'net', xCm: 1800, yCm: 800 });
  // Half a metre west of the cloth, inside where 45° ropes would reach.
  const tent = shape({ id: 'tent', kind: 'tent', xCm: 1450, yCm: 1000, widthCm: 300, depthCm: 300, insetCm: null });

  it('derive exactly what they did before while no angle is set anywhere (D16)', () => {
    const before = derive(PLOT, [net, tent]);
    expect(before.items.map((entry) => entry.outside)).toEqual([false, false]);
    expect(before.ropePairs).toEqual([]);
    expect(before.counts.outside).toBe(0);
    expect(before.counts.takenAreaM2).toBe(73); // 64 + 9, apart: the cloth, not ropes
    expect(derive(PLOT, [net, tent], {})).toEqual(before);
    expect(derive(PLOT, [net, tent], campAt(null))).toEqual(before);
  });

  it('put a net whose ropes cross the fence outside, and pair it with what stands in its band', () => {
    const roped = derive(PLOT, [net, tent], campAt(45));
    expect(roped.items.find((entry) => entry.id === 'net')?.outside).toBe(true);
    expect(roped.counts.outside).toBe(1);
    expect(roped.ropePairs).toEqual([['net', 'tent']]);
    // Nets are never part of an overlap pair: the band is its own check.
    expect(roped.pairs).toEqual([]);
  });

  it('counts a net flush with the fence by its ropes as inside, at 20° and 80°, on its kind’s height and on its own (Review Focus #1)', () => {
    const cases: Array<{ defaults: KindDefaults; own: Partial<ItemShape>; rope: number }> = [
      { defaults: campAt(20), own: {}, rope: 824 },
      { defaults: campAt(80), own: {}, rope: 53 },
      { defaults: {}, own: { heightCm: 400, ropeAngleDeg: 20 }, rope: 1099 },
      { defaults: {}, own: { heightCm: 400, ropeAngleDeg: 80 }, rope: 71 },
    ];
    for (const { defaults, own, rope } of cases) {
      const plot = { widthCm: 800 + rope * 2, depthCm: 800 + rope * 2, gridCm: 50 };
      const flush = shape({ id: 'n', xCm: rope, yCm: rope, ...own });
      expect(derive(plot, [flush], defaults).items[0].outside).toBe(false);
      expect(derive(plot, [{ ...flush, xCm: rope - 1 }], defaults).items[0].outside).toBe(true);
      expect(derive(plot, [{ ...flush, yCm: rope + 1 }], defaults).items[0].outside).toBe(true);
    }
  });

  it('flags a tent under one net that reaches into its neighbour’s band, and only there (Review Focus #5)', () => {
    // Two nets edge to edge, 2 m high with ropes at 45°: each band runs 2 m out from its cloth.
    const west = shape({ id: 'west', xCm: 400, yCm: 400, heightCm: 200, ropeAngleDeg: 45 });
    const east = shape({ id: 'east', xCm: 1200, yCm: 400, heightCm: 200, ropeAngleDeg: 45 });
    // Wholly under the west cloth (4–12 m), inside the east band (10–22 m).
    const under = shape({ id: 'tent', kind: 'tent', xCm: 1000, yCm: 600, widthCm: 150, depthCm: 150, insetCm: null });
    expect(derive(PLOT, [west, east, under]).ropePairs).toEqual([['east', 'tent']]);
  });

  it('take the area as the union of footprints inside the fence, ropes included, counting shared ground once', () => {
    // An 8 × 8 m net with 3 m ropes is 14 × 14 m; a tent under its cloth adds nothing.
    const alone = shape({ id: 'n' });
    const under = shape({ id: 't', kind: 'tent', xCm: 600, yCm: 600, widthCm: 300, depthCm: 300, insetCm: null });
    expect(derive(PLOT, [alone, under], campAt(45)).counts.takenAreaM2).toBe(196);
  });
});
