/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FEE_VIEWS } from '@/lib/fees/views';
import { FeeViews } from './fee-views';

const SEASON = '8f2b1c4e-0000-4000-8000-000000000001';

const COUNTS = {
  all: 35, unpaid: 0, partial: 3, paid: 21, exception: 5, offset: 5, nodue: 2,
};

describe('FeeViews', () => {
  it('lists every view, each one a URL a lead can send', () => {
    render(<FeeViews counts={COUNTS} seasonId={SEASON} view="all" />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent))
      .toEqual(FEE_VIEWS.map((one) => `${one.label}${COUNTS[one.id]}`));
  });

  it('leaves the default view out of its own link, so the canonical URL stays short', () => {
    render(<FeeViews counts={COUNTS} seasonId={SEASON} view="all" />);
    expect(screen.getByRole('tab', { name: /הכול/ }).getAttribute('href'))
      .toBe(`/fees?season=${SEASON}`);
    expect(screen.getByRole('tab', { name: /טרם שילמו/ }).getAttribute('href'))
      .toBe(`/fees?season=${SEASON}&view=unpaid`);
  });

  it('marks the view on screen as the selected one', () => {
    render(<FeeViews counts={COUNTS} seasonId={SEASON} view="partial" />);
    expect(screen.getByRole('tab', { name: /שילמו חלקית/ }).getAttribute('aria-selected'))
      .toBe('true');
    expect(screen.getByRole('tab', { name: /הכול/ }).getAttribute('aria-selected'))
      .toBe('false');
  });

  /**
   * A zero beside טרם שילמו is the best news this screen can carry, and
   * dropping the tab would hide it. Break this by filtering `counts[id] > 0`.
   */
  it('keeps a view whose count is zero, because that zero is the news', () => {
    render(<FeeViews counts={COUNTS} seasonId={SEASON} view="all" />);
    expect(screen.getByRole('tab', { name: /^טרם שילמו\s*0$/ })).toBeDefined();
  });
});
