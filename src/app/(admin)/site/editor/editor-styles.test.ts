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

function declarations(selector: string, sheet = SHEET): string {
  const pattern = new RegExp(`(?:^|[}\\s])${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g');
  return [...sheet.matchAll(pattern)].map((match) => match[1]).join(';');
}

/** The index of the `}` that closes the `{` at `open`. */
function closing(open: number): number {
  let depth = 0;
  for (let at = open; at < SHEET.length; at += 1) {
    if (SHEET[at] === '{') depth += 1;
    if (SHEET[at] === '}') depth -= 1;
    if (depth === 0) return at;
  }
  return SHEET.length;
}

/** What sits inside `@media <query> { … }`; '' when the sheet has no such block. */
function mediaBlock(query: string): string {
  const start = SHEET.indexOf(`@media ${query}`);
  if (start < 0) return '';
  const open = SHEET.indexOf('{', start);
  return SHEET.slice(open + 1, closing(open));
}

/** Everything outside any `@media` block. */
function outsideMedia(): string {
  let out = '';
  let at = 0;
  for (let start = SHEET.indexOf('@media'); start >= 0; start = SHEET.indexOf('@media', at)) {
    out += SHEET.slice(at, start);
    at = closing(SHEET.indexOf('{', start)) + 1;
  }
  return out + SHEET.slice(at);
}

/* Spec §7: under 900 px the item table is the view. The editor asks the
   browser about its width (`WIDE_QUERY`, `site-editor.tsx`) to decide whether
   to mount the scene; the stylesheet draws the same line before the client
   has answered, as the server renders the wide page. The two must agree, or a
   screen at the line would get neither view, or both. */
describe('the table under 900 px', () => {
  const EDITOR = readFileSync(resolve(process.cwd(), 'src/app/(admin)/site/editor/site-editor.tsx'), 'utf8');

  it('is where the editor draws the line too', () => {
    expect(EDITOR).toContain("const WIDE_QUERY = '(min-width: 900px)';");
    expect(mediaBlock('(max-width: 899.98px)')).not.toBe('');
  });

  it('is hidden on a wide screen, and shown in place of the editor on a narrow one', () => {
    expect(declarations('.narrowView', outsideMedia())).toMatch(/display:\s*none/);
    const narrow = mediaBlock('(max-width: 899.98px)');
    expect(declarations('.narrowView', narrow)).toMatch(/display:\s*block/);
    expect(declarations('.editorArea', narrow)).toMatch(/display:\s*none/);
  });
});

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
