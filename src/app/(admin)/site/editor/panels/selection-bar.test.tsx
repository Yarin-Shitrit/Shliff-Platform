/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { unnamedControls } from '@/test/a11y';
import { SelectionBar } from './selection-bar';

describe('the selection bar', () => {
  it('floats over the middle of the selection’s top edge, and is gone while there is no box', () => {
    const calls = { onTurn: vi.fn(), onDuplicate: vi.fn(), onLock: vi.fn(), onRemove: vi.fn() };
    const { container, rerender } = render(<SelectionBar box={{ l: 100, t: 200, r: 300, b: 260 }} locked {...calls} />);
    const bar = screen.getByRole('group', { name: 'פעולות על הבחירה' });
    // Physical on purpose: a point on the map does not mirror, and neither does the bar on it.
    expect(bar.style.left).toBe('200px');
    expect(bar.style.top).toBe('190px');
    expect(bar.dataset.panel).toBe('true');
    expect(unnamedControls(container)).toEqual([]);
    expect(within(bar).getByRole('button', { name: 'נעילה' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(bar).getByRole('button', { name: 'סיבוב ברבע' }));
    fireEvent.click(within(bar).getByRole('button', { name: 'שכפול' }));
    // Ruling P17: the lock is pressed and checked like the other three.
    fireEvent.click(within(bar).getByRole('button', { name: 'נעילה' }));
    fireEvent.click(within(bar).getByRole('button', { name: 'הסרה' }));
    expect([calls.onTurn, calls.onDuplicate, calls.onLock, calls.onRemove]
      .every((call) => call.mock.calls.length === 1)).toBe(true);
    rerender(<SelectionBar box={null} locked={false} {...calls} />);
    expect(screen.queryByRole('group', { name: 'פעולות על הבחירה' })).toBeNull();
  });

  it('stays below the top edge of the stage when the selection reaches it', () => {
    const calls = { onTurn: vi.fn(), onDuplicate: vi.fn(), onLock: vi.fn(), onRemove: vi.fn() };
    render(<SelectionBar box={{ l: 0, t: 4, r: 40, b: 60 }} locked={false} {...calls} />);
    const bar = screen.getByRole('group', { name: 'פעולות על הבחירה' });
    expect(bar.style.left).toBe('20px');
    expect(bar.style.top).toBe('8px');
    expect(within(bar).getByRole('button', { name: 'נעילה' }).getAttribute('aria-pressed')).toBe('false');
  });
});
