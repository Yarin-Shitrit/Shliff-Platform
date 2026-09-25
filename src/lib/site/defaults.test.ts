import { describe, it, expect } from 'vitest';
import { effectiveSize, isCustomised, itemHeight, presetSize } from './defaults';

describe('kind defaults', () => {
  it('fall back to the preset, with the default inset for a net only', () => {
    expect(presetSize('tent')).toEqual({ widthCm: 300, depthCm: 300, heightCm: 200, insetCm: null, ropeAngleDeg: null });
    expect(presetSize('shade')).toEqual({ widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: null });
  });

  it('prefer the camp\'s own size when there is one', () => {
    const defaults = { tent: { widthCm: 350, depthCm: 300, heightCm: 210, insetCm: null, ropeAngleDeg: null } };
    expect(effectiveSize('tent', defaults)).toEqual(defaults.tent);
    expect(effectiveSize('sofa', defaults)).toEqual(presetSize('sofa'));
    expect(isCustomised('tent', defaults)).toBe(true);
    expect(isCustomised('sofa', defaults)).toBe(false);
  });

  it('take an item\'s own height, else its kind\'s', () => {
    const defaults = { tent: { widthCm: 350, depthCm: 300, heightCm: 210, insetCm: null, ropeAngleDeg: null } };
    expect(itemHeight({ kind: 'tent', heightCm: null }, defaults)).toBe(210);
    expect(itemHeight({ kind: 'tent', heightCm: 180 }, defaults)).toBe(180);
    expect(itemHeight({ kind: 'sofa', heightCm: null }, {})).toBe(80);
  });

  it('have no rope angle until the camp sets one, and then the nets’ angle is the camp’s (spec D16)', () => {
    expect(presetSize('shade').ropeAngleDeg).toBeNull();
    const defaults = { shade: { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 } };
    expect(effectiveSize('shade', defaults).ropeAngleDeg).toBe(45);
    expect(effectiveSize('tent', defaults).ropeAngleDeg).toBeNull();
  });
});
