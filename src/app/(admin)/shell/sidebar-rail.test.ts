import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The rail's links scroll inside it when the rail is taller than the window
 * (Ruling X1), so a page that fits the screen is never lengthened by the nav
 * — and, below 1024px, so a phone's one-viewport drawer never leaves its last
 * group and its footer (the sign-out, the theme toggle) below the screen's
 * edge with nothing to scroll: on a 664px phone the rail's content is 975px.
 *
 * jsdom lays nothing out, so this reads the stylesheet; what it looks like at
 * 1280×800, 1440×900 and 1920×1080 is checked in a browser (plan 04,
 * integration I). The rules pinned here are the ones a later edit could undo
 * without anything else failing: the scroll box exists at every width, each
 * width gives `.side` the definite height the box needs, and it shows that it
 * hides something.
 */
const SHEET = readFileSync(resolve(process.cwd(), 'src/app/(admin)/shell/sidebar.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const DESKTOP = '@media (min-width: 1024px) {';
const DRAWER = '@media (max-width: 1023.98px) {';

/** One media block's body, and the sheet without it. */
function split(sheet: string, prelude: string): { block: string; rest: string } {
  const start = sheet.indexOf(prelude);
  if (start < 0) return { block: '', rest: sheet };
  let depth = 0;
  for (let at = start + prelude.length - 1; at < sheet.length; at += 1) {
    if (sheet[at] === '{') depth += 1;
    if (sheet[at] === '}') {
      depth -= 1;
      if (depth === 0) {
        return { block: sheet.slice(start + prelude.length, at), rest: sheet.slice(0, start) + sheet.slice(at + 1) };
      }
    }
  }
  throw new Error(`the ${prelude} block never closes`);
}

/** The declarations of every rule for exactly this selector, joined. */
function declarations(block: string, selector: string): string {
  const pattern = new RegExp(`(?:^|[}\\s])${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g');
  return [...block.matchAll(pattern)].map((match) => match[1]).join(';');
}

describe('the rail’s scroll box', () => {
  const { block: desktop, rest: withoutDesktop } = split(SHEET, DESKTOP);
  const { block: drawer, rest } = split(withoutDesktop, DRAWER);

  it('is found where it is looked for — the check can see a rule at all', () => {
    expect(desktop).not.toBe('');
    expect(drawer).not.toBe('');
    expect(declarations(rest, '.navgroup')).toContain('flex-direction: column');
  });

  it('is the groups’ own box at every width, not a desktop-only rule', () => {
    const box = declarations(rest, '.navstack');
    expect(box).toContain('overflow-y: auto');
    expect(box).toContain('min-block-size: 0');
    // Neither media block re-declares it: one box, one set of rules.
    expect(declarations(desktop, '.navstack')).toBe('');
    expect(declarations(drawer, '.navstack')).toBe('');
  });

  it('has a definite height to scroll inside, at each width in that width’s own way', () => {
    // A flex item in the page's row: containment keeps its content out of the row's height (X1).
    expect(declarations(desktop, '.side')).toContain('contain: size');
    // A fixed drawer one viewport tall: the aside fills it, so the footer stays at the edge.
    expect(declarations(drawer, '.side')).toContain('block-size: 100%');
    expect(declarations(drawer, '.rail')).toContain('inset-block: 0');
  });

  it('shows there is more below with a shadow drawn behind the links, never over them', () => {
    const box = declarations(rest, '.navstack');
    // Scroll shadows: a cover that travels with the links, over a shadow fixed to the box.
    expect(box).toMatch(/background-attachment:\s*local,\s*scroll/);
    // Tokens only: no colour of its own.
    expect(box).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});
