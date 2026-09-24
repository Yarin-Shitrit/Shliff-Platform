import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The editor's stage reaches the panel's edges, and the panel (`.main`,
 * `layout.module.css`) clips what overflows it. A focus ring drawn outside the
 * stage would be cut on three sides (A9: the ring is never removed, and a ring
 * three-quarters gone is close to removed), so the stage draws it inside
 * itself. jsdom lays nothing out: this reads the stylesheet, and the browser
 * check is in the integration report.
 */
const SHEET = readFileSync(resolve(process.cwd(), 'src/app/(admin)/site/editor/editor.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function declarations(selector: string): string {
  const pattern = new RegExp(`(?:^|[}\\s])${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g');
  return [...SHEET.matchAll(pattern)].map((match) => match[1]).join(';');
}

describe('the editor’s stage', () => {
  it('is found where it is looked for', () => {
    expect(declarations('.stage')).toContain('overflow: hidden');
  });

  it('draws its focus ring inside itself, where the panel does not clip it', () => {
    expect(declarations('.stage')).toMatch(/outline-offset:\s*-2px/);
  });

  /* Inside the stage, the stage's own outline paints under the scene — an
     absolutely placed layer that covers it edge to edge. The ring is drawn
     again by a layer that comes after the scene, and lets every pointer
     through to it. */
  /*
   * The floating cards (the sun, the shortcuts) stack up from above the view
   * controls. Taller together than the stage — 1280 × 800 with both open —
   * the stage would clip the top one, and the sun card's play button, slider
   * and strip with it. The stack stops below the checks bar and scrolls.
   * 64 and 56 are `INSETS.bottom` and `INSETS.top` in `site-editor.tsx`,
   * pinned by `site-editor.test.tsx`'s first test.
   */
  it('keeps the card stack between the view controls and the checks bar, scrolling past that', () => {
    const cards = declarations('.cards');
    expect(cards).toMatch(/inset-block-end:\s*64px/);
    expect(cards).toMatch(/max-block-size:\s*calc\(100% - 64px - 56px\)/);
    expect(cards).toMatch(/overflow-y:\s*auto/);
    expect(cards).toMatch(/overscroll-behavior:\s*contain/);
  });

  it('draws that ring over the map, where the map cannot cover it, and never takes a click', () => {
    const ring = declarations('.stage:focus-visible::after');
    expect(ring).toMatch(/position:\s*absolute/);
    expect(ring).toMatch(/inset:\s*0/);
    expect(ring).toMatch(/pointer-events:\s*none/);
    expect(ring).toMatch(/outline:\s*2px solid var\(--focus\)/);
    expect(ring).toMatch(/outline-offset:\s*-2px/);
  });
});
