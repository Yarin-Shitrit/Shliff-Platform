import * as THREE from 'three';

/**
 * A label as ink (plan 2026-09-26-site-label-modes, Task 2): the text drawn
 * once, white on transparent, into a texture that `scene/prints.ts` lays on
 * the item's face. White because the ink's colour is the print material's
 * `color`, which multiplies the texture — so one texture serves both themes,
 * and a theme flip recolours without drawing again (D2).
 *
 * One texture per distinct text: forty tents named "אוהל" share one. The
 * cache is forgotten when the web font arrives (`reset`), since a texture
 * drawn in the fallback font is the wrong shape.
 */
export interface Print {
  texture: THREE.Texture;
  /** Width ÷ height of the drawn text block — what keeps the print's proportions when it is fitted to a face. */
  aspect: number;
}

export interface PrintRasteriser {
  /** The same text gives the same Print until `reset()`; null where nothing can be drawn (no canvas 2D). */
  print(text: string): Print | null;
  /** The font changed (`document.fonts.ready`): forget every texture so the next `print()` draws afresh. */
  reset(): void;
  dispose(): void;
  /** How many textures are held — for tests and the 200-item measurement. */
  readonly size: number;
}

/** The texture's height. A print is scaled to its face, so this sets only how crisp the ink is. */
const HEIGHT_PX = 128;
/** Clear space either side of the text, so the ink never touches the texture's edge and bleeds at a distance. */
const PAD_PX = 20;
/** Room above and below the glyphs: Hebrew's ascenders (ל) and descenders (ך ן ף ץ) reach past the x-height. */
const FONT_PX = 84;

/**
 * Draws with a 2D canvas. `fontFamily` is read at each draw, so the stage's
 * computed family — the web font once it has loaded — is what the ink is in.
 * A canvas that gives no 2D context (jsdom, a tab with canvas blocked) is
 * asked once; from then on every print is null and nothing throws.
 */
export function canvasRasteriser(fontFamily: () => string, maxAnisotropy: number): PrintRasteriser {
  const prints = new Map<string, Print>();
  let blocked = false;

  const draw = (text: string): Print | null => {
    if (blocked || typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (context === null) {
      blocked = true;
      return null;
    }
    const font = `700 ${FONT_PX}px ${fontFamily()}`;
    context.font = font;
    const width = Math.max(1, Math.ceil(context.measureText(text).width + PAD_PX * 2));
    canvas.width = width;
    canvas.height = HEIGHT_PX;
    // Sizing the canvas resets the context, so the font is set again after it.
    context.font = font;
    context.direction = 'rtl';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#FFFFFF';
    context.fillText(text, width / 2, HEIGHT_PX / 2);
    const texture = new THREE.CanvasTexture(canvas);
    // An alpha mask carries no colour, so no colour space is set on it.
    texture.anisotropy = maxAnisotropy;
    texture.needsUpdate = true;
    return { texture, aspect: width / HEIGHT_PX };
  };

  const forget = (): void => {
    for (const print of prints.values()) print.texture.dispose();
    prints.clear();
  };

  return {
    print(text) {
      const held = prints.get(text);
      if (held !== undefined) return held;
      const drawn = draw(text);
      if (drawn !== null) prints.set(text, drawn);
      return drawn;
    },
    reset: forget,
    dispose: forget,
    get size() {
      return prints.size;
    },
  };
}
