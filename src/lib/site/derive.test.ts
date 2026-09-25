import { describe, it, expect } from 'vitest';
import type { KindDefaults } from './defaults';
import { ropeCmOf, toPlaced, type ItemShape } from './derive';

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
