import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The kit's contract with plan 01. Every token listed here is read by a
 * stylesheet in `src/components/ui/`. If plan 01 renames one, this fails here
 * rather than rendering a transparent panel on a white canvas.
 */
const KIT_TOKENS = [
  '--canvas', '--panel', '--sunken', '--hover', '--selected',
  '--line', '--line-strong',
  '--ink', '--ink-2', '--ink-3', '--ink-4',
  '--brand', '--brand-hover', '--brand-ink', '--brand-text', '--brand-soft',
  '--focus',
  '--ok', '--ok-soft', '--warn', '--warn-soft', '--warn-line',
  '--bad', '--bad-soft', '--info', '--info-soft',
  '--viz-track', '--shadow-pop', '--shadow-drawer',
];

/** A3 names these as differing in dark; the rest carry over from A2. */
const DARK_TOKENS = [
  '--canvas', '--panel', '--sunken', '--hover', '--selected',
  '--line', '--line-strong', '--ink', '--ink-2', '--ink-3', '--ink-4',
  '--brand-text', '--brand-soft', '--focus',
  '--ok', '--ok-soft', '--warn', '--warn-soft', '--warn-line',
  '--bad', '--bad-soft', '--info', '--info-soft', '--viz-track',
];

describe('tokens.css', () => {
  const css = readFileSync(join(process.cwd(), 'src/app/tokens.css'), 'utf8');

  it.each(KIT_TOKENS)('defines %s', (token) => {
    expect(css.includes(`${token}:`)).toBe(true);
  });

  it('redefines the dark palette under the attribute selector', () => {
    const at = css.indexOf("[data-theme='dark']");
    expect(at).toBeGreaterThan(-1);
    const dark = css.slice(at);
    for (const token of DARK_TOKENS) {
      expect(dark.includes(`${token}:`), `${token} is not redefined in dark`).toBe(true);
    }
  });

  it('redefines the dark palette under the OS preference too', () => {
    expect(css.includes('prefers-color-scheme: dark')).toBe(true);
    expect(css.includes(":root:not([data-theme='light'])")).toBe(true);
  });
});
