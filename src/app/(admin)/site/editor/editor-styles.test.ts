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

  /* Ranges, not `min-width: 900px` against `max-width: 899.98px`: at a
     fractional width between the two (a zoomed page) neither matched, and the
     screen got both views or neither. */
  it('is where the editor draws the line too, with no width left between the two sides', () => {
    expect(EDITOR).toContain("const WIDE_QUERY = '(width >= 900px)';");
    expect(mediaBlock('(width < 900px)')).not.toBe('');
    expect(SHEET).not.toMatch(/899\.98|min-width:\s*900px|max-width:\s*900px/);
  });

  it('is hidden on a wide screen, and shown in place of the editor on a narrow one', () => {
    expect(declarations('.narrowView', outsideMedia())).toMatch(/display:\s*none/);
    const narrow = mediaBlock('(width < 900px)');
    expect(declarations('.narrowView', narrow)).toMatch(/display:\s*flex/);
    expect(declarations('.editorArea', narrow)).toMatch(/display:\s*none/);
  });

  /* The server renders the wide page, export button included; on a phone the
     stylesheet hides it before the client has asked the width. */
  it('takes the picture button away on a narrow screen before the client has answered', () => {
    expect(declarations('.wideOnly', mediaBlock('(width < 900px)'))).toMatch(/display:\s*none/);
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
  it('draws that ring over the map, where the map cannot cover it, and never takes a click', () => {
    const ring = declarations('.stage:focus-visible::after');
    expect(ring).toMatch(/position:\s*absolute/);
    expect(ring).toMatch(/inset:\s*0/);
    expect(ring).toMatch(/pointer-events:\s*none/);
    expect(ring).toMatch(/outline:\s*2px solid var\(--focus\)/);
    expect(ring).toMatch(/outline-offset:\s*-2px/);
  });
});
