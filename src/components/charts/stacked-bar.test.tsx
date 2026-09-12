/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { StackedBar } from './stacked-bar';

describe('StackedBar', () => {
  it('direct-labels both segments and names them in a legend', () => {
    render(<StackedBar
      segments={[
        { id: 'dues', label: 'דמי קאמפ', valueAgorot: 4200000, series: 1 },
        { id: 'raise', label: 'גיוס', valueAgorot: 2237530, series: 2 },
      ]}
      totalAgorot={6437530}
    />);
    // Label and value each appear twice by design: once in the visible
    // legend, once in the always-present table view.
    expect(screen.getAllByText('דמי קאמפ')).toHaveLength(2);
    expect(screen.getAllByText('גיוס')).toHaveLength(2);
    expect(screen.getAllByText(/42,000/)).toHaveLength(2);
    expect(screen.getAllByText(/22,375.30/)).toHaveLength(2);
  });

  it('shows the unfilled remainder as a named gap, not a third series', () => {
    render(<StackedBar
      segments={[{ id: 'raised', label: 'גויס', valueAgorot: 1000000, series: 1 }]}
      totalAgorot={2237530}
      remainderLabel="נותר לגייס"
    />);
    expect(screen.getAllByText('נותר לגייס')).toHaveLength(2);
    expect(screen.getAllByText(/12,375.30/)).toHaveLength(2);
  });

  it('carries a table view alongside the legend, same as every other chart', () => {
    // The bar's segment widths are drawn in an aria-hidden SVG — the legend
    // repeats label/value as plain text, but a <table> is still the
    // structured, column-headed non-visual reading every chart ships.
    render(<StackedBar
      segments={[
        { id: 'dues', label: 'דמי קאמפ', valueAgorot: 4200000, series: 1 },
        { id: 'raise', label: 'גיוס', valueAgorot: 2237530, series: 2 },
      ]}
      totalAgorot={6437530}
    />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('דמי קאמפ')).toBeTruthy();
    expect(within(table).getByText('גיוס')).toBeTruthy();
  });

  it('omits the legend for a single segment with no remainder — the title already names it', () => {
    render(<StackedBar
      segments={[{ id: 'raised', label: 'גויס', valueAgorot: 2237530, series: 1 }]}
      totalAgorot={2237530}
    />);
    // Only one entry total (one segment, no remainder to show): a legend
    // here would be a single swatch restating what the chart's own title
    // already says. The label should appear once — in the table view only —
    // not twice.
    expect(screen.getAllByText('גויס')).toHaveLength(1);
    expect(within(screen.getByRole('table')).getByText('גויס')).toBeTruthy();
  });
});
