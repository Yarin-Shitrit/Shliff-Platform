import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVENT_DAY_COUNT } from '@/lib/logistics/shift-time';

/**
 * The shifts stylesheet, read as the browser would take it — jsdom lays
 * nothing out, so what is checked here is the sheet itself: the phone rules
 * that let a lead run the board from a phone standing in the camp.
 *
 * Before they existed the board was a 760px table in a sideways scroller,
 * which on a 390px screen showed the gate day and half of the next, and the
 * three top-bar buttons wrapped under a 52px bar onto the heading. The rules
 * pinned here are the ones a later edit could undo without any other test
 * noticing.
 */
const SHEET = readFileSync(join(process.cwd(), 'src/app/(admin)/logistics/shifts/shifts.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const TOKENS = readFileSync(join(process.cwd(), 'src/app/tokens.css'), 'utf8');
const PHONE = '@media (max-width: 767.98px)';

/** The phone blocks' bodies and the rest of the sheet, split by walking braces. */
function split(css: string): { phone: string; laptop: string } {
  const phone: string[] = [];
  let laptop = '';
  let from = 0;
  for (;;) {
    const start = css.indexOf(PHONE, from);
    if (start < 0) { laptop += css.slice(from); break; }
    laptop += css.slice(from, start);
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
    phone.push(css.slice(open + 1, index));
    from = index + 1;
  }
  return { phone: phone.join('\n'), laptop };
}

/** Every rule of a block that has no nested braces: its selectors and its declarations. */
function rules(block: string): Array<{ selectors: string[]; declarations: string }> {
  return [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1].split(',').map((one) => one.trim()).filter((one) => one !== ''),
    declarations: match[2].replace(/\s+/g, ' ').trim(),
  }));
}

/** The declarations of every rule naming exactly this selector, joined. */
function declarations(block: string, selector: string): string {
  return rules(block)
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.declarations)
    .join('; ');
}

function orderOf(block: string, selector: string): number {
  const match = /order:\s*(-?\d+)/.exec(declarations(block, selector));
  if (!match) throw new Error(`${selector} has no order`);
  return Number(match[1]);
}

const { phone, laptop } = split(SHEET);

describe('the shifts board on a phone', () => {
  it('has phone rules at the width every other module changes at, never a stray 768px', () => {
    expect(phone).not.toBe('');
    expect(SHEET).not.toMatch(/max-width:\s*768px/);
  });

  it('stops the sideways scroll and lays the one table out as a single-column grid', () => {
    expect(declarations(laptop, '.boardWrap')).toContain('overflow-x: auto');
    expect(declarations(laptop, '.board')).toContain('min-inline-size: 760px');
    expect(declarations(phone, '.boardWrap')).toContain('overflow: visible');
    const board = declarations(phone, '.board');
    expect(board).toContain('display: grid');
    expect(board).toContain('min-inline-size: 0');
    for (const part of ['.board thead', '.board tbody', '.board tr']) {
      expect(declarations(phone, part)).toContain('display: contents');
    }
  });

  /**
   * The regrouping is `order`, one rule per day for the header and one for
   * the cells. The count comes from the event, not from the sheet: a day the
   * event gained and the sheet did not would land at the end of the grid in
   * DOM order, between nothing and nothing, and no browser would say so.
   */
  it('orders every one of the event\'s days: its header, its shifts, then its empty kinds, and the next day after', () => {
    let previous = -1;
    for (let index = 0; index < EVENT_DAY_COUNT; index += 1) {
      const header = orderOf(phone, `.board thead th[data-day='${index}']`);
      const cells = orderOf(phone, `.board td[data-day='${index}']`);
      const empties = orderOf(phone, `.board td[data-day='${index}']:not(:has(.slot))`);
      expect(header).toBeGreaterThan(previous);
      expect(cells).toBeGreaterThan(header);
      expect(empties).toBeGreaterThan(cells);
      previous = empties;
    }
    // And no rule for a day the event does not have, which would be a guess.
    expect(declarations(phone, `.board thead th[data-day='${EVENT_DAY_COUNT}']`)).toBe('');
  });

  it('keeps the row headers for a reader rather than removing them', () => {
    const clipped = declarations(phone, '.board tbody th');
    expect(clipped).toContain('clip-path: inset(50%)');
    expect(clipped).not.toContain('display: none');
  });

  it('draws the day strip on a phone only', () => {
    expect(declarations(laptop, '.dayNav')).toContain('display: none');
    expect(declarations(phone, '.dayNav')).toContain('display: flex');
  });

  it('moves the verbs out of the top bar and into a fixed bar above the tab bar', () => {
    expect(declarations(phone, '.topActions')).toContain('display: none');
    const bar = declarations(phone, '.phoneActions');
    expect(bar).toContain('position: fixed');
    expect(bar).toContain('z-index: var(--z-bulk)');
    // Clears the tab bar by its own rendered height, the same calc the shell uses.
    expect(bar).toContain('var(--tap-min) + var(--space-2) * 2');
    // And is not drawn on a laptop, where the top bar has the room.
    expect(declarations(laptop, '.phoneActions')).toContain('display: none');
  });

  it('leaves room under the page for that bar, so the last row is never under it', () => {
    expect(declarations(phone, '.page')).toMatch(/padding-block-end:\s*\d+px/);
  });

  it('gives every phone target the 44px floor: a card, an empty day, a day chip, a type chip, a box', () => {
    for (const target of ['.slot', '.addSlot', '.dayLink']) {
      expect(declarations(phone, target)).toContain('min-block-size: var(--tap-min)');
    }
    expect(declarations(phone, '.chip')).toContain('block-size: 44px');
    expect(declarations(phone, '.plainInput')).toContain('min-block-size: 44px');
  });

  it('lets a drawer\'s three footer buttons wrap instead of overflowing the sheet', () => {
    expect(declarations(laptop, '.footActions')).toContain('display: contents');
    const wrapped = declarations(phone, '.footActions');
    expect(wrapped).toContain('display: flex');
    expect(wrapped).toContain('flex-wrap: wrap');
  });

  it('draws only in tokens that exist', () => {
    const defined = new Set([...TOKENS.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((match) => match[1]));
    const used = [...SHEET.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((match) => match[1]);
    expect(used.filter((token) => !defined.has(token))).toEqual([]);
    // `--row-head` is a height; the header surface is the kit table's `--sunken`.
    expect(declarations(laptop, '.board thead th')).toContain('background: var(--sunken)');
    expect(declarations(laptop, '.board tbody th')).toContain('background: var(--sunken)');
  });
});
