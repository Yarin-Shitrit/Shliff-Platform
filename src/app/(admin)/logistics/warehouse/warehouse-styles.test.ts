import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The warehouse's stylesheet, read as the browser would take it — jsdom lays
 * nothing out, so what is checked here is the sheet itself: the phone rules
 * that make this screen usable one-handed in the storage container.
 *
 * Measured in Chromium at 390×664 before they existed: the top bar's crumbs,
 * chip and two buttons came to 518px, the whole page overflowed sideways, and
 * הוספת פריט sat 124px past the left edge of the screen. The rules pinned
 * here are the ones a later edit could undo without any other test noticing.
 */
const SHEET = readFileSync(join(process.cwd(), 'src/app/(admin)/logistics/warehouse/warehouse.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const PHONE = '@media (max-width: 767.98px)';

/** Every phone block's body, joined — the sheet has more than one. */
function phoneRules(css: string): string {
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const start = css.indexOf(PHONE, from);
    if (start < 0) break;
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
    bodies.push(css.slice(open + 1, index));
    from = index;
  }
  return bodies.join('\n');
}

/** The declarations of every rule for exactly this selector, joined. */
function declarations(block: string, selector: string): string {
  const pattern = new RegExp(`(?:^|[}\\s])${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`, 'g');
  return [...block.matchAll(pattern)].map((match) => match[1]).join(';');
}

describe('the warehouse on a phone', () => {
  const phone = phoneRules(SHEET);
  const laptop = SHEET.replace(/@media \(max-width: 767\.98px\)\s*\{[\s\S]*?\n\}/g, '');

  it('has phone rules at the width every other module changes at, never a stray 768px', () => {
    expect(phone).not.toBe('');
    expect(SHEET).not.toMatch(/max-width:\s*768px/);
  });

  it('moves the two verbs out of the top bar and into a fixed bar above the tab bar', () => {
    expect(declarations(phone, '.topActions')).toContain('display: none');
    const bar = declarations(phone, '.phoneActions');
    expect(bar).toContain('position: fixed');
    expect(bar).toContain('z-index: var(--z-bulk)');
    // Clears the tab bar by its own rendered height, the same calc the shell uses.
    expect(bar.replace(/\s+/g, ' ')).toContain('var(--tap-min) + var(--space-2) * 2');
    // And is not drawn on a laptop, where the top bar has the room.
    expect(declarations(laptop, '.phoneActions')).toContain('display: none');
  });

  it('leaves room under the list for that bar, so the last card is never under it', () => {
    expect(declarations(phone, '.page')).toMatch(/padding-block-end:\s*\d+px/);
  });

  it('gives every phone target the 44px floor: the count’s −/+, the location chips, the box', () => {
    expect(declarations(phone, '.step')).toContain('min-block-size: 44px');
    expect(declarations(phone, '.suggestion')).toContain('min-block-size: 44px');
    expect(declarations(phone, '.plainInput')).toContain('min-block-size: 44px');
  });

  it('keeps the three tiles side by side rather than stacking them over the list', () => {
    // Stacked, they pushed the first item 930px down a 664px screen.
    expect(declarations(phone, '.tiles')).not.toContain('grid-template-columns: 1fr');
  });

  it('draws the count box in tokens that exist', () => {
    // `--surface` and `--ink-1` were never in tokens.css: the box had no
    // background and inherited its colour by accident.
    expect(SHEET).not.toMatch(/var\(--surface\)|var\(--ink-1\)/);
  });
});
