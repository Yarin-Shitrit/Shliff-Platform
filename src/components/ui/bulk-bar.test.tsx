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
  it('keeps no toolbar in view or in the tree when nothing is selected', () => {
    // Not literally nothing any more (see the next test): a silent,
    // permanently-mounted live region has to persist even at zero so its
    // *first* content change is announced. What must still be absent is the
    // bar itself — its region role, its accessible name, every button.
    render(
      <BulkBar count={0} label="פעולות על הנבחרים" actions={actions} onClear={vi.fn()} />,
    );
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the live region mounted before the first selection, so it is announced', () => {
    // A screen reader only announces a *change* to a live region that was
    // already present in the DOM — a region created at the same moment as
    // its content is not reliably announced. So the count's aria-live
    // element must exist even at count={0}, before there is a selection to
    // announce, not just once the bar has something to say.
    const { container, rerender } = render(
      <BulkBar count={0} label="פעולות על הנבחרים" actions={actions} onClear={vi.fn()} />,
    );
    expect(container.querySelector('[aria-live]')).not.toBeNull();

    rerender(<BulkBar count={2} label="פעולות על הנבחרים" actions={actions} onClear={vi.fn()} />);
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
