import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The sun card's stylesheet, read as the browser would take it — jsdom lays
 * nothing out and paints nothing, so what is checked here is the sheet
 * itself: the phone targets, and the contrast of the shade strip's marks,
 * computed from the real tokens (the way `stat-tile.test.tsx` does it).
 */
const SHEET = readFileSync(join(process.cwd(), 'src/app/(admin)/site/editor/panels/sun-card.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const TOKENS = readFileSync(join(process.cwd(), 'src/app/tokens.css'), 'utf8');

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

describe('the sun card on a phone', () => {
  it('gives every day chip, every speed and scope option, and every ranked tent a full-size target', () => {
    const coarse = block(SHEET, '@media (pointer: coarse)');
    expect(property(block(coarse, '.chip'), 'block-size')).toBe('var(--tap-min)');
    expect(property(block(coarse, '.optionFace'), 'block-size')).toBe('var(--tap-min)');
    expect(property(block(coarse, '.tentRow'), 'block-size')).toBe('var(--tap-min)');
    expect(property(block(coarse, '.disclosure'), 'block-size')).toBe('var(--tap-min)');
  });
});

/* ── contrast ──────────────────────────────────────────────────────────── */

type Palette = Record<string, string>;

function palette(body: string): Palette {
  return Object.fromEntries([...body.matchAll(/--([\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})\s*;/g)].map((m) => [m[1], m[2]]));
}

const LIGHT = palette(block(TOKENS, ':root {'));
const DARK = { ...LIGHT, ...palette(block(TOKENS, ":root[data-theme='dark']")) };

function channels(hex: string): number[] {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
}

/** A colour the sheet writes — `var(--x)`, or `color-mix(in srgb, var(--a) N%, var(--b))` — in one theme. */
function resolve(value: string, tokens: Palette): number[] {
  const plain = /^var\(--([\w-]+)\)$/.exec(value);
  if (plain !== null) return channels(tokens[plain[1]]);
  const mixed = /^color-mix\(in srgb, var\(--([\w-]+)\) (\d+)%, var\(--([\w-]+)\)\)$/.exec(value);
  if (mixed === null) throw new Error(`not a token colour: ${value}`);
  const share = Number(mixed[2]) / 100;
  const [a, b] = [channels(tokens[mixed[1]]), channels(tokens[mixed[3]])];
  return a.map((channel, index) => share * channel + (1 - share) * b[index]);
}

/** WCAG 2 relative luminance and contrast ratio. */
function luminance([r, g, b]: number[]): number {
  const linear = (channel: number) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: number[], b: number[]): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('the shade strip’s marks', () => {
  const fill = (selector: string) => property(block(SHEET, `${selector} {`), 'fill');

  /*
   * WCAG 1.4.11: a mark needed to read the strip stands 3:1 against what it
   * touches. Full shade touches part shade and the sun (when a column has no
   * part shade); part shade touches both. So every pair, in both themes.
   */
  it.each([['light', LIGHT], ['dark', DARK]] as const)('stand 3:1 against every mark beside them, %s', (_theme, tokens) => {
    const full = resolve(fill('.fullMark'), tokens);
    const partial = resolve(fill('.partialMark'), tokens);
    const sun = resolve(fill('.sunMark'), tokens);
    expect(contrast(full, partial)).toBeGreaterThanOrEqual(3);
    expect(contrast(partial, sun)).toBeGreaterThanOrEqual(3);
    expect(contrast(full, sun)).toBeGreaterThanOrEqual(3);
  });

  it('are the legend’s colours, so the key cannot drift from the marks', () => {
    const background = (selector: string) => property(block(SHEET, `${selector} {`), 'background');
    expect(background('.fullKey')).toBe(fill('.fullMark'));
    expect(background('.partialKey')).toBe(fill('.partialMark'));
    expect(background('.sunKey')).toBe(fill('.sunMark'));
  });
});
