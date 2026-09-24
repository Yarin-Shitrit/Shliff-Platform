import { describe, it, expect } from 'vitest';
import { KIND_ORDER, SITE_KINDS } from './kinds';

describe('kind presets', () => {
  it('give every kind a height, a plural and a shape', () => {
    for (const kind of KIND_ORDER) {
      const preset = SITE_KINDS[kind];
      expect(Number.isInteger(preset.heightCm) && preset.heightCm >= 10).toBe(true);
      expect(preset.plural.trim()).not.toBe('');
      expect(['box', 'sofa', 'tent', 'cylinder', 'fire', 'net']).toContain(preset.shape);
    }
  });

  it('draw a shade net as a net and a tent as a tent', () => {
    expect(SITE_KINDS.shade.shape).toBe('net');
    expect(SITE_KINDS.tent.shape).toBe('tent');
    expect(SITE_KINDS.toilet.plural).toBe('תאי שירותים');
  });
});
