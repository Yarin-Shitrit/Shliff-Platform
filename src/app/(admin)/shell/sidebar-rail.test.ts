import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The rail's links scroll inside it when the rail is taller than the window
 * (Ruling X1), so a page that fits the screen is never lengthened by the nav.
 *
 * jsdom lays nothing out, so this reads the stylesheet; what it looks like at
 * 1280×800, 1440×900 and 1920×1080 is checked in a browser (plan 04,
 * integration I). The rules pinned here are the ones a later edit could undo
 * without anything else failing: the scroll box is a desktop rule only, and it
 * shows that it hides something.
 */
const SHEET = readFileSync(resolve(process.cwd(), 'src/app/(admin)/shell/sidebar.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const DESKTOP = '@media (min-width: 1024px) {';

/** The desktop block's body, and the sheet without it. */
function split(sheet: string): { desktop: string; rest: string } {
  const start = sheet.indexOf(DESKTOP);
  if (start < 0) return { desktop: '', rest: sheet };
  let depth = 0;
  for (let at = start + DESKTOP.length - 1; at < sheet.length; at += 1) {
    if (sheet[at] === '{') depth += 1;
    if (sheet[at] === '}') {
      depth -= 1;
      if (depth === 0) {
        return { desktop: sheet.slice(start + DESKTOP.length, at), rest: sheet.slice(0, start) + sheet.slice(at + 1) };
      }
    }
  }
  throw new Error('the desktop block never closes');
}

/** The declarations of every rule for exactly this selector, joined. */
function declarations(block: string, selector: string): string {
  const pattern = new RegExp(`(?:^|[}\\s])${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g');
  return [...block.matchAll(pattern)].map((match) => match[1]).join(';');
}

describe('the rail’s scroll box', () => {
  const { desktop, rest } = split(SHEET);

  it('is found where it is looked for — the check can see a rule at all', () => {
    expect(desktop).not.toBe('');
    expect(declarations(rest, '.navgroup')).toContain('flex-direction: column');
  });

  it('exists only from 1024px up; below that the links are the drawer’s, as they were', () => {
    expect(declarations(rest, '.navstack').replace(/\s/g, '')).toBe('display:contents;');
    expect(declarations(desktop, '.navstack')).toContain('overflow-y: auto');
  });

  it('shows there is more below with a shadow drawn behind the links, never over them', () => {
    const box = declarations(desktop, '.navstack');
    // Scroll shadows: a cover that travels with the links, over a shadow fixed to the box.
    expect(box).toMatch(/background-attachment:\s*local,\s*scroll/);
    // Tokens only: no colour of its own.
    expect(box).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});
