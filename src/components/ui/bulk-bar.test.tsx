/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BulkBar, selectionLabel } from './bulk-bar';

const actions = [
  { id: 'season', label: 'שיוך לשנה', onSelect: vi.fn() },
  { id: 'export', label: 'ייצוא', onSelect: vi.fn() },
];

describe('selectionLabel', () => {
  it('agrees with the number', () => {
    expect(selectionLabel(1)).toBe('נבחר אחד');
    expect(selectionLabel(2)).toBe('2 נבחרו');
    expect(selectionLabel(35)).toBe('35 נבחרו');
  });
});

describe('BulkBar', () => {
  it('renders nothing when nothing is selected', () => {
    const { container } = render(
      <BulkBar count={0} label="פעולות על הנבחרים" actions={actions} onClear={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('names itself and announces the count politely', () => {
    render(<BulkBar count={2} label="פעולות על הנבחרים" actions={actions} onClear={vi.fn()} />);
    const region = screen.getByRole('region', { name: 'פעולות על הנבחרים' });
    expect(region).toBeTruthy();
    const live = screen.getByText(/נבחרו/);
    expect(live.getAttribute('aria-live')).toBe('polite');
  });

  it('offers each action', () => {
    render(<BulkBar count={2} label="פעולות על הנבחרים" actions={actions} onClear={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'שיוך לשנה' }));
    expect(actions[0].onSelect).toHaveBeenCalledTimes(1);
  });

  it('keeps the destructive ones behind עוד', () => {
    const remove = vi.fn();
    render(
      <BulkBar
        count={2}
        label="פעולות על הנבחרים"
        actions={actions}
        moreActions={[{ id: 'remove', label: 'הסרה מהשנה', onSelect: remove }]}
        onClear={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'הסרה מהשנה' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    fireEvent.click(screen.getByRole('button', { name: 'הסרה מהשנה' }));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('offers a way out of the selection', () => {
    const onClear = vi.fn();
    render(<BulkBar count={2} label="פעולות על הנבחרים" actions={actions} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: 'ביטול הבחירה' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
