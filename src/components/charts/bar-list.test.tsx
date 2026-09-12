/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { BarList } from './bar-list';

describe('BarList', () => {
  it('renders every item with its value and a table view', () => {
    render(<BarList items={[
      { id: 'a', label: 'עו״ש אופק', valueAgorot: 1407955 },
      { id: 'b', label: 'קופת מזומן', valueAgorot: 158400 },
    ]} />);
    // The label and value appear twice by design: once in the visible bar
    // row, once in the always-present table view (the non-visual reading).
    // getByText would throw on the ambiguity, so assert both occurrences.
    expect(screen.getAllByText('עו״ש אופק')).toHaveLength(2);
    expect(screen.getAllByText(/14,079.55/)).toHaveLength(2);
    const table = screen.getByRole('table');
    expect(table).toBeTruthy();
    expect(within(table).getByText('עו״ש אופק')).toBeTruthy();
    expect(within(table).getByText('קופת מזומן')).toBeTruthy();
  });

  it('shows a note beside an item that carries one, with its own icon', () => {
    render(<BarList items={[{
      id: 'a', label: 'עו״ש אופק', valueAgorot: 1407955,
      tone: 'warning', note: 'חשבון פרטי של חבר מחנה',
    }]} />);
    expect(screen.getByText('חשבון פרטי של חבר מחנה')).toBeTruthy();
    // status never carries meaning by colour alone
    expect(screen.getByRole('img', { name: /אזהרה/ })).toBeTruthy();
  });

  it('renders nothing but an invitation when there are no items', () => {
    render(<BarList items={[]} emptyMessage="עדיין אין חשבונות" />);
    expect(screen.getByText('עדיין אין חשבונות')).toBeTruthy();
  });

  it('paints every nominal bar in the same series-1 hue, never a per-item colour', () => {
    // These are nominal categories (named accounts), not a ranked series.
    // Colouring a bar by its own value would spend the identity channel
    // re-encoding what the bar's length already shows.
    const { container } = render(<BarList items={[
      { id: 'a', label: 'חשבון א', valueAgorot: 100 },
      { id: 'b', label: 'חשבון ב', valueAgorot: 200 },
      { id: 'c', label: 'חשבון ג', valueAgorot: 300 },
    ]} />);
    const bars = Array.from(container.querySelectorAll('svg > rect:nth-of-type(2)'));
    expect(bars).toHaveLength(3);
    const classNames = bars.map((bar) => bar.getAttribute('class'));
    expect(new Set(classNames).size).toBe(1);
  });
});
