/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { canvasRasteriser } from './print-texture';

/** The little of a 2D context the rasteriser uses: jsdom has no canvas, so the drawing is recorded, not done. */
function fakeContext() {
  return {
    font: '', direction: 'ltr', textAlign: 'start', textBaseline: 'alphabetic', fillStyle: '',
    measureText: vi.fn((text: string) => ({ width: text.length * 60 })),
    fillText: vi.fn(), fillRect: vi.fn(), clearRect: vi.fn(),
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(), rotate: vi.fn(),
  };
}

function withContext(context: ReturnType<typeof fakeContext> | null) {
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a label rasterised as ink', () => {
  it('returns null without a 2D context, asks for one only once, and holds nothing', () => {
    const getContext = withContext(null);
    const prints = canvasRasteriser(() => 'Heebo', 8);
    expect(prints.print('אוהל 1')).toBeNull();
    expect(prints.print('אוהל 2')).toBeNull();
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(prints.size).toBe(0);
  });

  it('gives one texture per distinct text, white ink drawn centred in the stage’s font, right to left', () => {
    const context = fakeContext();
    withContext(context);
    const prints = canvasRasteriser(() => 'Heebo, sans-serif', 8);

    const a = prints.print('אוהל 1');
    const b = prints.print('קראוון של דנה');
    expect(a).not.toBeNull();
    expect(prints.print('אוהל 1')).toBe(a);
    expect(b).not.toBe(a);
    expect(prints.size).toBe(2);

    // 6 glyphs × 60 px, plus 20 px of padding each side, over a 128 px tall texture.
    expect(a!.aspect).toBeCloseTo((6 * 60 + 40) / 128, 6);
    expect(a!.texture.anisotropy).toBe(8);
    expect(context.font).toBe('700 84px Heebo, sans-serif');
    expect(context.direction).toBe('rtl');
    expect(context.textAlign).toBe('center');
    expect(context.textBaseline).toBe('middle');
    expect(context.fillStyle).toBe('#FFFFFF');
    expect(context.fillText).toHaveBeenCalledTimes(2);
    expect(context.fillText).toHaveBeenCalledWith('אוהל 1', (6 * 60 + 40) / 2, 64);
  });

  it('forgets everything on reset — the next print draws again, and the old texture is freed', () => {
    const context = fakeContext();
    withContext(context);
    const prints = canvasRasteriser(() => 'Heebo', 1);
    const before = prints.print('אוהל 1')!;
    const freed = vi.spyOn(before.texture, 'dispose');

    prints.reset();

    expect(prints.size).toBe(0);
    expect(freed).toHaveBeenCalledTimes(1);
    const after = prints.print('אוהל 1');
    expect(after).not.toBe(before);
    expect(context.fillText).toHaveBeenCalledTimes(2);
  });

  it('reads the font family at each draw, so the web font is used once it has arrived', () => {
    const context = fakeContext();
    withContext(context);
    let family = 'system-ui';
    const prints = canvasRasteriser(() => family, 1);
    prints.print('בר');
    expect(context.font).toBe('700 84px system-ui');
    family = 'Heebo';
    prints.reset();
    prints.print('בר');
    expect(context.font).toBe('700 84px Heebo');
  });
});
