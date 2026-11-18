import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The rules that keep a table inside its frame at laptop width, read from the
 * stylesheets — the companion of `phone-layout.test.ts`, for the widths above
 * the card reflow.
 *
 * jsdom lays nothing out, so none of this can be seen by a component test.
 * Every rule below was found by opening all the app's screens in Chromium at
 * 768, 1024, 1280, 1366 and 1536px with rows as long as the camp's real ones,
 * and measuring `scrollWidth` against `clientWidth`. Each `it` names the
 * defect it keeps from coming back. Whether a screen *looks* right is still a
 * browser's question; this only stops a later edit from quietly deleting the
 * fix.
 */
function sheet(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The body of the first block that opens at `prelude` (brace-counted). */
function block(css: string, prelude: string): string {
  const start = css.indexOf(prelude);
  if (start < 0) throw new Error(`no block for ${prelude}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let at = open; at < css.length; at += 1) {
    if (css[at] === '{') depth += 1;
    if (css[at] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, at);
    }
  }
  throw new Error(`the ${prelude} block never closes`);
}

/** The sheet with every `@media` block cut out: what applies at any width. */
function unconditional(css: string): string {
  let out = css;
  for (let at = out.indexOf('@media'); at >= 0; at = out.indexOf('@media')) {
    const body = block(out.slice(at), '@media');
    const end = out.indexOf(body, at) + body.length + 1;
    out = out.slice(0, at) + out.slice(end);
  }
  return out;
}

const TABLE = sheet('src/components/ui/table.module.css');
const LAYOUT = sheet('src/app/(admin)/layout.module.css');
const GLOBALS = sheet('src/app/globals.css');

describe('a table cell', () => {
  // `white-space: nowrap` on every cell made a table as wide as its longest
  // row: תנועות ran 394px past its frame and רכש 511px, at every screen width.
  it('wraps, so a long description costs a second line and not a sideways scroll', () => {
    expect(block(unconditional(TABLE), '.table td {')).not.toContain('white-space');
  });

  // A figure broken across two lines no longer lines up by place value, and a
  // shrink-to-fit slot that wraps collapses to one control per line.
  it('still holds a figure and a shrink-to-fit slot on one line', () => {
    const rule = /\.table td\.numeric,\s*\.table td\.w0\s*\{([^}]*)\}/.exec(unconditional(TABLE));
    expect(rule?.[1]).toContain('white-space: nowrap');
  });
});

describe('a page', () => {
  // An auto margin on a flex item sizes it to its content. At 1024px חובות
  // laid out 960px wide in a 772px panel that clips: 189px of every row was
  // cut off with no scrollbar to reach it.
  it('is exactly as wide as its panel at every width, never as wide as its content', () => {
    expect(block(unconditional(LAYOUT), '.main > main {')).toContain('inline-size: 100%');
  });

  // At 60rem a nine-column table had 926px to live in on a 1366px laptop with
  // 90px of bare panel either side of it, and on any screen wider than that.
  it('may use the width a laptop has before it is capped', () => {
    const cap = /max-inline-size:\s*(\d+)rem/.exec(block(GLOBALS, '\nmain {'));
    expect(Number(cap?.[1])).toBeGreaterThanOrEqual(80);
  });
});
