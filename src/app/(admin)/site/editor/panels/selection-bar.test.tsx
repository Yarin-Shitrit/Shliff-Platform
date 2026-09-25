/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { unnamedControls } from '@/test/a11y';
import { BAR, placeBar, SelectionBar } from './selection-bar';

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

  /* Review minor (H1 6). The bar hangs above its anchor (translate -100%),
     so the old `max(8, t − 10)` kept the anchor on the stage but put the bar
     itself above it, clipped; and nothing kept it from the side edges. */
  it('goes under the selection when there is no room above it, and stays inside the stage', () => {
    const calls = { onTurn: vi.fn(), onDuplicate: vi.fn(), onLock: vi.fn(), onRemove: vi.fn() };
    render(<SelectionBar box={{ l: 0, t: 4, r: 40, b: 60 }} stage={{ width: 800, height: 600 }} locked={false} {...calls} />);
    const bar = screen.getByRole('group', { name: 'פעולות על הבחירה' });
    expect(bar.dataset.place).toBe('below');
    expect(bar.style.top).toBe('70px');
    // Half the bar's widest (four 44 px targets) plus the edge: it never pokes past the stage's side.
    expect(bar.style.left).toBe(`${8 + BAR.width / 2}px`);
    expect(within(bar).getByRole('button', { name: 'נעילה' }).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('where the selection bar goes', () => {
  const stage = { width: 800, height: 600 };

  it('sits above the middle of the selection when it fits there', () => {
    expect(placeBar({ l: 100, t: 200, r: 300, b: 260 }, stage)).toEqual({ left: 200, top: 190, place: 'above' });
    // Exactly enough room above: still above.
    const t = 8 + BAR.height + 10;
    expect(placeBar({ l: 300, t, r: 500, b: 400 }, stage).place).toBe('above');
    expect(placeBar({ l: 300, t: t - 1, r: 500, b: 400 }, stage)).toEqual({ left: 400, top: 410, place: 'below' });
  });

  it('keeps clear of both side edges', () => {
    expect(placeBar({ l: 0, t: 300, r: 40, b: 340 }, stage).left).toBe(8 + BAR.width / 2);
    expect(placeBar({ l: 760, t: 300, r: 800, b: 340 }, stage).left).toBe(800 - 8 - BAR.width / 2);
    // A stage narrower than the bar: the middle of the stage, the best there is.
    expect(placeBar({ l: 0, t: 300, r: 40, b: 340 }, { width: 150, height: 600 }).left).toBe(75);
  });

  /* #25 fix round, Minor 12: the bottom edge is kept in both placements —
     a selection scrolled past the stage's bottom put the bar under it too. */
  it('keeps above the stage’s bottom edge when the selection is below it', () => {
    expect(placeBar({ l: 100, t: 900, r: 300, b: 960 }, stage)).toEqual({ left: 200, top: 600 - 8, place: 'above' });
    expect(placeBar({ l: 100, t: 610, r: 300, b: 700 }, stage)).toEqual({ left: 200, top: 600 - 8, place: 'above' });
  });

  it('stays on the stage when the selection fills it top to bottom', () => {
    expect(placeBar({ l: 100, t: 20, r: 300, b: 590 }, stage)).toEqual({ left: 200, top: 600 - 8 - BAR.height, place: 'below' });
  });

  it('places by the selection alone until the stage has been measured', () => {
    expect(placeBar({ l: 0, t: 4, r: 40, b: 60 }, null)).toEqual({ left: 20, top: 70, place: 'below' });
  });
});
