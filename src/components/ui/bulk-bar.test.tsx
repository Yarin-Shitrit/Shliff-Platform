/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BulkBar, selectionLabel, type DestructiveBulkAction } from './bulk-bar';

const actions = [
  { id: 'season', label: 'שיוך לשנה', onSelect: vi.fn() },
  { id: 'export', label: 'ייצוא', onSelect: vi.fn() },
];

function destructiveAction(onConfirmed: () => void = vi.fn()): DestructiveBulkAction {
  return {
    id: 'remove',
    label: 'הסרה מהשנה',
    confirm: {
      title: 'הסרת שיוך מהשנה',
      consequence: (count) => `${count} תשלומים יוסרו מהשנה הנוכחית.`,
      confirmLabel: 'הסרת השיוך',
    },
    onConfirmed,
  };
}

describe('selectionLabel', () => {
  it('agrees with the number', () => {
    expect(selectionLabel(1)).toBe('נבחר אחד');
    expect(selectionLabel(2)).toBe('2 נבחרו');
    expect(selectionLabel(35)).toBe('35 נבחרו');
  });
});

describe('BulkBar', () => {
  it('keeps no toolbar in view or in the tree when nothing is selected', () => {
    render(
      <BulkBar count={0} label="פעולות על הנבחרים" actions={actions} onClear={vi.fn()} />,
    );
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the live region mounted before the first selection, so it is announced', () => {
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

  it('fires a non-destructive action immediately, with no dialog', () => {
    render(<BulkBar count={2} label="פעולות על הנבחרים" actions={actions} onClear={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'שיוך לשנה' }));
    expect(actions[0].onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('keeps a destructive action behind עוד, hidden until opened', () => {
    render(
      <BulkBar
        count={2}
        label="פעולות על הנבחרים"
        actions={actions}
        moreActions={[destructiveAction()]}
        onClear={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'הסרה מהשנה' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    expect(screen.getByRole('button', { name: 'הסרה מהשנה' })).toBeTruthy();
  });

  it('opens a confirmation instead of running the destructive action immediately', () => {
    const onConfirmed = vi.fn();
    render(
      <BulkBar
        count={2}
        label="פעולות על הנבחרים"
        actions={actions}
        moreActions={[destructiveAction(onConfirmed)]}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    fireEvent.click(screen.getByRole('button', { name: 'הסרה מהשנה' }));
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'הסרת שיוך מהשנה' })).toBeTruthy();
  });

  it('names the selection count in the confirmation sentence', () => {
    render(
      <BulkBar
        count={7}
        label="פעולות על הנבחרים"
        actions={actions}
        moreActions={[destructiveAction()]}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    fireEvent.click(screen.getByRole('button', { name: 'הסרה מהשנה' }));
    expect(screen.getByText('7 תשלומים יוסרו מהשנה הנוכחית.')).toBeTruthy();
  });

  it('runs onConfirmed exactly once when the reader confirms', () => {
    const onConfirmed = vi.fn();
    render(
      <BulkBar
        count={2}
        label="פעולות על הנבחרים"
        actions={actions}
        moreActions={[destructiveAction(onConfirmed)]}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    fireEvent.click(screen.getByRole('button', { name: 'הסרה מהשנה' }));
    fireEvent.click(screen.getByRole('button', { name: 'הסרת השיוך' }));
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('runs onConfirmed zero times when the reader cancels', () => {
    const onConfirmed = vi.fn();
    render(
      <BulkBar
        count={2}
        label="פעולות על הנבחרים"
        actions={actions}
        moreActions={[destructiveAction(onConfirmed)]}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    fireEvent.click(screen.getByRole('button', { name: 'הסרה מהשנה' }));
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('offers a way out of the selection', () => {
    const onClear = vi.fn();
    render(<BulkBar count={2} label="פעולות על הנבחרים" actions={actions} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: 'ביטול הבחירה' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
