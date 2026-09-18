/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { StatTile } from './stat-tile';

describe('StatTile', () => {
  it('renders money through formatILS with the symbol last', () => {
    render(<StatTile label="נגבה" valueAgorot={2430000} />);
    expect(screen.getByText('24,300 ₪')).toBeTruthy();
  });

  it('keeps the derivation line, so no number is unexplained', () => {
    render(
      <StatTile
        label="צפי גבייה"
        valueAgorot={3650000}
        derivation="28 בתעריף רגיל · 5 חריגים"
      />,
    );
    expect(screen.getByText('28 בתעריף רגיל · 5 חריגים')).toBeTruthy();
  });

  it('renders a non-money figure as it was given', () => {
    render(<StatTile label="כיסוי משימות" value={<bdi>5/8</bdi>} />);
    expect(screen.getByText('5/8')).toBeTruthy();
  });

  it('names its bar for assistive technology', () => {
    render(
      <StatTile
        label="נגבה"
        valueAgorot={2430000}
        bar={{ label: '67% מהצפי', segments: [{ id: 'paid', percent: 62, kind: 'dues' }] }}
      />,
    );
    expect(screen.getByRole('img', { name: '67% מהצפי' })).toBeTruthy();
  });

  it('links the whole tile onward when the figure has a page that can change it', () => {
    render(<StatTile label="חובות פתוחים" valueAgorot={1400000} href="/money/debts" />);
    expect(screen.getByRole('link', { name: /חובות פתוחים/ }).getAttribute('href'))
      .toBe('/money/debts');
  });

  it('is not a link when there is nowhere to go', () => {
    render(<StatTile label="יצא בשנה הזו" valueAgorot={500000} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});

/**
 * C11's rule is that no number is unexplained — which fails silently if the
 * explanation cannot be read. What actually protects that rule is a contrast
 * ratio, not which token name appears in the stylesheet: grepping for
 * `var(--ink-3)` passes even if `.derivation` stops being applied to
 * anything, and can only fail if someone hand-edits that one line. So this
 * computes the real contrast ratio of whatever colour token `.derivation`
 * uses against `--panel`, reading `src/app/tokens.css` the way
 * `src/app/tokens.test.ts` does, and asserts it clears the WCAG AA
 * normal-text threshold (4.5:1). `--ink-4` on `--panel` is 2.52:1 and fails
 * that; `--ink-3` is 5.82:1 and clears it. This replaces the check that used
 * to live in `src/app/tokens.test.ts` against `charts.module.css`'s
 * `.tileDerivation`, retired by this migration.
 */
describe('stat-tile.module.css', () => {
  /** Brace-counting block extraction, same approach as `src/app/tokens.test.ts`. */
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

  /** `--ink-3` must not match `--ink-30` or similar, same guard as tokens.test.ts. */
  function tokenValue(body: string, name: string): string {
    const match = body.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
    if (!match) throw new Error(`no value for --${name}`);
    return match[1].trim();
  }

  function relativeLuminance(hex: string): number {
    const value = hex.replace('#', '');
    const channel = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const r = channel(parseInt(value.slice(0, 2), 16));
    const g = channel(parseInt(value.slice(2, 4), 16));
    const b = channel(parseInt(value.slice(4, 6), 16));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrastRatio(hexA: string, hexB: string): number {
    const a = relativeLuminance(hexA);
    const b = relativeLuminance(hexB);
    const lighter = Math.max(a, b);
    const darker = Math.min(a, b);
    return (lighter + 0.05) / (darker + 0.05);
  }

  it('keeps the derivation line on a token that clears readable-text contrast', () => {
    const componentCss = readFileSync(
      join(process.cwd(), 'src/components/ui/stat-tile.module.css'),
      'utf8',
    );
    const derivationRule = block(componentCss, '.derivation {');
    const usedToken = derivationRule.match(/color:\s*var\(--([\w-]+)\)/);
    expect(usedToken).not.toBeNull();

    const tokensCss = readFileSync(join(process.cwd(), 'src/app/tokens.css'), 'utf8');
    const root = block(tokensCss, ':root {');
    const derivationHex = tokenValue(root, usedToken![1]);
    const panelHex = tokenValue(root, 'panel');

    // WCAG AA for normal-size text. This is the actual risk plan 01 poses:
    // it can move --ink-3 itself, not just swap the token name here.
    expect(contrastRatio(derivationHex, panelHex)).toBeGreaterThanOrEqual(4.5);
  });
});
