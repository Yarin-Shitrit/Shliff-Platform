/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { unnamedControls } from '@/test/a11y';
import { SelectionActions } from './selection-actions';

/* This file's own fixture. */
function renderActions(locked: boolean, labelled: boolean) {
  const calls = { onTurn: vi.fn(), onDuplicate: vi.fn(), onLock: vi.fn(), onRemove: vi.fn() };
  const { container } = render(<SelectionActions locked={locked} labelled={labelled} {...calls} />);
  return { calls, container };
}

describe('the selection’s actions', () => {
  it('names each action in words in the inspector’s footer, and each button runs its own', () => {
    const { calls } = renderActions(false, true);
    fireEvent.click(screen.getByRole('button', { name: 'סיבוב' }));
    fireEvent.click(screen.getByRole('button', { name: 'שכפול' }));
    fireEvent.click(screen.getByRole('button', { name: 'נעילה' }));
    fireEvent.click(screen.getByRole('button', { name: 'הסרה' }));
    for (const handler of Object.values(calls)) expect(handler).toHaveBeenCalledTimes(1);
  });

  it('keeps the lock’s name and carries its state in aria-pressed', () => {
    renderActions(true, true);
    expect(screen.getByRole('button', { name: 'נעילה' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('draws icons by the selection, each still named', () => {
    const { calls, container } = renderActions(false, false);
    expect(unnamedControls(container)).toEqual([]);
    expect(screen.getByRole('button', { name: 'נעילה' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'סיבוב ברבע' }));
    fireEvent.click(screen.getByRole('button', { name: 'שכפול' }));
    fireEvent.click(screen.getByRole('button', { name: 'נעילה' }));
    fireEvent.click(screen.getByRole('button', { name: 'הסרה' }));
    for (const handler of Object.values(calls)) expect(handler).toHaveBeenCalledTimes(1);
  });

  it('offers group and ungroup only when given one, in words and as named icons', () => {
    // A button that would answer with nothing is not drawn (one item cannot be a group; nothing here is grouped).
    renderActions(false, true);
    expect(screen.queryByRole('button', { name: 'קיבוץ' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'פירוק הקיבוץ' })).toBeNull();
    cleanup();

    const onGroup = vi.fn();
    const onUngroup = vi.fn();
    const base = { onTurn: vi.fn(), onDuplicate: vi.fn(), onLock: vi.fn(), onRemove: vi.fn() };
    render(<SelectionActions locked={false} labelled {...base} onGroup={onGroup} onUngroup={onUngroup} />);
    fireEvent.click(screen.getByRole('button', { name: 'קיבוץ' }));
    fireEvent.click(screen.getByRole('button', { name: 'פירוק הקיבוץ' }));
    expect(onGroup).toHaveBeenCalledTimes(1);
    expect(onUngroup).toHaveBeenCalledTimes(1);
    cleanup();

    const { container } = render(<SelectionActions locked={false} labelled={false} {...base} onGroup={onGroup} onUngroup={onUngroup} />);
    expect(unnamedControls(container)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'קיבוץ' }));
    fireEvent.click(screen.getByRole('button', { name: 'פירוק הקיבוץ' }));
    expect(onGroup).toHaveBeenCalledTimes(2);
    expect(onUngroup).toHaveBeenCalledTimes(2);
  });
});
