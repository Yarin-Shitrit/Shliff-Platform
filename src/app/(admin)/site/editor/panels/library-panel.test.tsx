/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { unnamedControls } from '@/test/a11y';
import type { KindDefaults } from '@/lib/site/defaults';
import { LibraryPanel } from './library-panel';

beforeAll(() => {
  // jsdom captures no pointer; the tile only needs the call to exist.
  Element.prototype.setPointerCapture = () => {};
});

function renderLibrary(defaults: KindDefaults = {}) {
  const calls = { onActivate: vi.fn(), onDragMove: vi.fn(), onDrop: vi.fn(), onDragCancel: vi.fn() };
  const { container } = render(<LibraryPanel defaults={defaults} {...calls} />);
  return { ...calls, container };
}

const tile = (name: RegExp) => screen.getByRole('button', { name });

describe('the library', () => {
  it('offers every kind, grouped, at the size it will land at', () => {
    const { container } = renderLibrary();
    expect(screen.getByText('לינה וצל')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'הוספת אוהל, 3 × 3 מ׳' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'הוספת קראוון, 7 × 2.5 מ׳' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^הוספת / })).toHaveLength(19);
    expect(unnamedControls(container)).toEqual([]);
  });

  it('shows the camp’s own default size, and says it was changed', () => {
    renderLibrary({ tent: { widthCm: 350, depthCm: 300, heightCm: 210, insetCm: null } });
    expect(screen.getByRole('button', { name: 'הוספת אוהל, 3.5 × 3 מ׳, גודל ברירת המחדל שונה' })).toBeTruthy();
  });

  it('finds a kind by its name, and says when there is none', () => {
    renderLibrary();
    const search = screen.getByRole('searchbox', { name: 'חיפוש פריט להוספה' });
    fireEvent.change(search, { target: { value: 'מקר' } });
    expect(screen.getAllByRole('button', { name: /^הוספת / }).map((button) => button.getAttribute('aria-label')))
      .toEqual(['הוספת מקרר, 0.7 × 0.7 מ׳']);
    fireEvent.change(search, { target: { value: 'חללית' } });
    expect(screen.getByText(/אין סוג כזה ברשימה/)).toBeTruthy();
  });

  it('places a kind on a click', () => {
    const { onActivate } = renderLibrary();
    fireEvent.click(tile(/^הוספת אוהל,/));
    expect(onActivate).toHaveBeenCalledWith('tent');
  });

  it('drags a kind: moves report where the pointer is, the drop lands it, and the click after the drop does not', () => {
    const { onActivate, onDragMove, onDrop } = renderLibrary();
    const tent = tile(/^הוספת אוהל,/);
    fireEvent.pointerDown(tent, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(tent, { pointerId: 1, clientX: 400, clientY: 300 });
    expect(onDragMove).toHaveBeenLastCalledWith('tent', 400, 300);
    fireEvent.pointerUp(tent, { pointerId: 1, clientX: 410, clientY: 305 });
    expect(onDrop).toHaveBeenCalledWith('tent', 410, 305);
    fireEvent.click(tent);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('lets the next press click when no click followed a drop, as none follows a finger’s drag', () => {
    const { onActivate, onDrop } = renderLibrary();
    const tent = tile(/^הוספת אוהל,/);
    fireEvent.pointerDown(tent, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(tent, { pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerUp(tent, { pointerId: 1, clientX: 400, clientY: 300 });
    expect(onDrop).toHaveBeenCalledTimes(1);
    // No click here: a touch that moved is not a tap. The next tap is a click of its own.
    fireEvent.pointerDown(tent, { pointerId: 2, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(tent, { pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.click(tent);
    expect(onActivate).toHaveBeenCalledWith('tent');
  });

  it('reports a drag the browser cancelled', () => {
    const { onDragCancel, onDrop } = renderLibrary();
    const tent = tile(/^הוספת אוהל,/);
    fireEvent.pointerDown(tent, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(tent, { pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerCancel(tent, { pointerId: 1 });
    expect(onDragCancel).toHaveBeenCalledTimes(1);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('treats a press that barely moves as a click', () => {
    const { onActivate, onDragMove } = renderLibrary();
    const tent = tile(/^הוספת אוהל,/);
    fireEvent.pointerDown(tent, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(tent, { pointerId: 1, clientX: 12, clientY: 11 });
    fireEvent.pointerUp(tent, { pointerId: 1, clientX: 12, clientY: 11 });
    fireEvent.click(tent);
    expect(onDragMove).not.toHaveBeenCalled();
    expect(onActivate).toHaveBeenCalledWith('tent');
  });
});
