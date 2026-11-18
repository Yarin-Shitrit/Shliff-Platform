import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The phone layout's load-bearing rules, read from the stylesheets.
 *
 * jsdom lays nothing out, so none of what is pinned here can be seen by a
 * component test — and every rule below was found the same way: by opening the
 * app at 390×664 in Chromium and measuring a defect that the whole suite had
 * passed over. Each `it` names the defect it keeps from coming back. What the
 * screens look like is still a browser's question; this only stops a later
 * edit from quietly deleting the fix.
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

/** Every `@media (max-width: 767.98px)` block in the sheet, joined. */
function phone(css: string): string {
  const prelude = '@media (max-width: 767.98px)';
  let out = '';
  for (let at = css.indexOf(prelude); at >= 0; at = css.indexOf(prelude, at + 1)) {
    out += block(css.slice(at), prelude);
  }
  if (out === '') throw new Error('no phone block');
  return out;
}

const TAB_BAR = sheet('src/app/(admin)/shell/tab-bar.module.css');
const SIDEBAR = sheet('src/app/(admin)/shell/sidebar.module.css');
const LAYOUT = sheet('src/app/(admin)/layout.module.css');
const TOP_BAR = sheet('src/components/shell/top-bar.module.css');
const TABLE = sheet('src/components/ui/table.module.css');
const BULK = sheet('src/components/ui/bulk-bar.module.css');
const DRAWER = sheet('src/components/ui/drawer.module.css');

describe('the עוד sheet', () => {
  // Sixteen 44px rows on a 664px screen: it grew past the top edge, and דמי
  // קאמפ, משימות and משמרות were off-screen with nothing to scroll.
  it('is never taller than the space above the tab bar, and scrolls inside it', () => {
    const rule = block(TAB_BAR, '.sheet {');
    expect(rule).toMatch(/max-block-size:\s*calc\(100dvh - /);
    expect(rule).toContain('overflow-y: auto');
  });

  it('keeps its close button on screen wherever the list is scrolled to', () => {
    const rule = block(TAB_BAR, '.sheetClose {');
    expect(rule).toContain('position: sticky');
    expect(rule).toContain('inset-block-end: 0');
    // Opaque, or the rows passing under it show through.
    expect(rule).toContain('background: var(--panel)');
  });
});

describe('the menu drawer on a phone', () => {
  const drawer = block(SIDEBAR, '@media (max-width: 1023.98px)');

  // Full-width below 768px, so the scrim is wholly underneath it.
  it('shows its own close button wherever it is a drawer, and nowhere else', () => {
    expect(block(drawer, '.railClose {')).toContain('display: inline-flex');
    expect(SIDEBAR.replace(drawer, '')).toMatch(/\.railClose\s*\{\s*display:\s*none;?\s*\}/);
  });

  it('gives that button a full touch target', () => {
    const rule = block(drawer, '.railClose {');
    expect(rule).toContain('inline-size: var(--tap-min)');
    expect(rule).toContain('block-size: var(--tap-min)');
  });

  // Pinned, the 44px button rode over whatever was being read.
  it('lets the menu button scroll away with the page, against the layout ground', () => {
    expect(block(phone(SIDEBAR), '.menubutton {')).toContain('position: absolute');
    expect(block(LAYOUT, '.ground {')).toContain('position: relative');
    // From 768px up there is no tab bar, so there it stays pinned.
    expect(block(drawer, '.menubutton {')).toContain('position: fixed');
  });
});

describe('a page on a phone', () => {
  // `main { margin-inline: auto }` sizes a page to its content; one row that
  // would not wrap widened בית, הקמה and רכש past the screen, and the panel's
  // `overflow: hidden` cut the rest off.
  it('is capped at the width of the panel it is in', () => {
    expect(block(phone(LAYOUT), '.main > main {')).toContain('max-inline-size: 100%');
  });

  // רכש's bar needed 526px of 390: the primary action was off the edge.
  it('has a top bar that wraps instead of pushing its actions off the edge', () => {
    const rule = block(phone(TOP_BAR), '.topbar {');
    expect(rule).toContain('flex-wrap: wrap');
    expect(rule).toContain('block-size: auto');
    expect(rule).toContain('min-block-size: 52px');
  });

  it('keeps the scope chip on one line — its height holds exactly one', () => {
    const rule = block(TOP_BAR, '.scopechip {');
    expect(rule).toContain('white-space: nowrap');
    expect(rule).toContain('flex-shrink: 0');
  });
});

describe('a table as cards', () => {
  const cards = phone(TABLE);

  // `.w0`'s 1% pinned the slot at 44px; חובות's two buttons spilled off-screen.
  it('gives the action slot its content’s width, and the whole line once it is alone on it', () => {
    expect(block(cards, ".table tbody td[data-card='action'] {")).toContain('inline-size: auto');
    expect(cards).toMatch(
      /tr:has\(td\[data-card='meta'\], td\[data-card='figure'\]\) td\[data-card='action'\]\s*\{\s*grid-column:\s*1 \/ -1/,
    );
  });

  // Tinted cell by cell, a flagged row was a ladder of stripes.
  it('paints a row’s tone on the card, with the cells transparent over it', () => {
    expect(cards).toMatch(/\.table tbody tr\[data-tone='bad'\]\s*\{\s*background:\s*var\(--bad-soft\)/);
    expect(cards).toMatch(/\.table tbody tr\[data-tone='warn'\]\s*\{\s*background:\s*var\(--warn-soft\)/);
    expect(cards).toMatch(/tr\[data-tone='bad'\] td,[^{]*\{\s*background:\s*transparent/);
  });

  // מסיבות drew four bare dashes; the ledger an amount with no direction.
  it('names a figure that is not alone beside the title', () => {
    expect(cards).toMatch(
      /tr:has\(td\[data-card='figure'\] ~ td\[data-card='figure'\]\) td\[data-card='figure'\]\[data-label\]:not\(:empty\)::before/,
    );
    expect(cards).toMatch(
      /tr:has\(td\[data-card='select'\]\) td\[data-card='figure'\]\[data-label\]:not\(:empty\)::before/,
    );
  });

  // As a table row in a block footer it shrank to a grey box in one corner.
  it('stacks the totals row full-width, lets it wrap, and draws each total’s name', () => {
    expect(block(cards, '.table tfoot tr {')).toContain('display: block');
    expect(block(cards, '.table tfoot td {')).toContain('white-space: normal');
    expect(block(cards, '.table tfoot td[data-label]::before {')).toContain("content: attr(data-label) ': '");
  });
});

describe('the bulk bar on a phone', () => {
  const rule = block(phone(BULK), '.bar {');

  // Flex items shrink before their container scrolls: five actions printed over each other.
  it('scrolls sideways for real — its items keep their own width', () => {
    expect(rule).toContain('overflow-x: auto');
    const items = block(phone(BULK), '.bar > * {');
    expect(items).toContain('flex-shrink: 0');
    expect(items).toContain('white-space: nowrap');
  });

  // At 20px from the window's bottom it sat on the tab bar.
  it('sits above the tab bar, home-indicator inset included', () => {
    expect(rule).toMatch(/inset-block-end:\s*calc\(\s*var\(--tap-min\)[^;]*env\(safe-area-inset-bottom\)/);
  });
});

describe('a drawer’s footer on a phone', () => {
  // The payment sheet's second button read "שמירה ומעבר לבא", cut short.
  it('wraps, and never squeezes a button below its label', () => {
    const sheetRules = phone(DRAWER);
    // Anchored to the line start: `.drawer[data-phone='full'] .foot` is a different rule.
    expect(sheetRules).toMatch(/\n\s*\.foot\s*\{\s*flex-wrap:\s*wrap/);
    expect(sheetRules).toMatch(/\.foot > button,\s*\.foot > a\s*\{\s*flex-shrink:\s*0/);
  });
});
