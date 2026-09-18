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
 * explanation cannot be read. `--ink-4` on `--panel` is 2.52:1; `--ink-3` is
 * the muted step that still clears text contrast. This replaces the check
 * that used to live in `src/app/tokens.test.ts` against
 * `charts.module.css`'s `.tileDerivation`, retired by this migration.
 */
describe('stat-tile.module.css', () => {
  it('keeps the derivation line on the readable muted step', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/ui/stat-tile.module.css'), 'utf8');
    const start = css.indexOf('.derivation {');
    expect(start).toBeGreaterThan(-1);
    const end = css.indexOf('}', start);
    expect(css.slice(start, end)).toContain('var(--ink-3)');
    expect(css.slice(start, end)).not.toContain('var(--ink-4)');
  });
});
