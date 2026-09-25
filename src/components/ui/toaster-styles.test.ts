import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The toaster's stylesheet, read as the browser would take it — jsdom lays
 * nothing out, so `toaster.test.tsx` cannot see this and this file pins it.
 *
 * The provider mounts its two live regions on every page, empty, at the top
 * of the z-index ladder, and on a phone across the whole width of the screen
 * at its bottom edge — exactly where the tab bar and a sheet's confirm button
 * are. Measured in Chromium at 390×664 before this was fixed: the empty
 * container was a 58px-tall box (two `<ol>`s' own 1em margins), and a tap on
 * the centre of every tab, and on רישום in the payment sheet, landed on it.
 * Nothing on screen said why.
 */
const SHEET = readFileSync(join(process.cwd(), 'src/components/ui/toaster.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of the first rule whose selector text starts at `selector` (brace-counted, as `tokens.test.ts`). */
function block(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no rule for ${selector}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  let index = open;
  for (; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return css.slice(open + 1, index);
}

function property(body: string, name: string): string {
  const match = new RegExp(`(?:^|[;{\\s])${name}\\s*:\\s*([^;]+);`).exec(body);
  if (match === null) throw new Error(`no ${name} in ${body}`);
  return match[1].trim();
}

describe('the toaster over the bottom of a phone', () => {
  it('never takes a tap itself; only a toast does', () => {
    // `.toast {` with its brace: `.toaster` starts with the same six characters.
    expect(property(block(SHEET, '.toaster {'), 'pointer-events')).toBe('none');
    expect(property(block(SHEET, '.toast {'), 'pointer-events')).toBe('auto');
  });

  it('is the size of its toasts — an empty region has no list margin or padding of its own', () => {
    const region = block(SHEET, '.region');
    expect(property(region, 'margin')).toBe('0');
    expect(property(region, 'padding')).toBe('0');
  });

  it('is still always mounted: neither region is ever display: none', () => {
    // The live-region ruling in toaster.tsx — a region that appears with its
    // first message is not reliably announced. The fix above must not have
    // reached for hiding instead.
    expect(block(SHEET, '.region')).not.toMatch(/display:\s*none/);
    expect(block(SHEET, '.toaster')).not.toMatch(/display:\s*none/);
  });
});
