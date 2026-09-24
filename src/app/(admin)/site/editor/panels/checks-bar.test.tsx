/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { derive, toPlaced } from '@/lib/site/derive';
import { overlapPairs } from '@/lib/site/geometry';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import { ChecksBar } from './checks-bar';

/* This file's own fixture. */
function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 500, yCm: 500, widthCm: 300, depthCm: 200,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

function doc(items: EditorItem[]): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, defaults: {} };
}

/** The flags, worked out with `derive.ts` — the server's rule — not with the store. */
function flagsOf(map: EditorDoc): EditorFlags {
  const { items } = derive(map.plot, map.items);
  return {
    outside: new Set(items.filter((entry) => entry.outside).map((entry) => entry.id)),
    overlapping: new Set(items.filter((entry) => entry.overlapping).map((entry) => entry.id)),
    partly: new Set(items.filter((entry) => entry.shade === 'partly').map((entry) => entry.id)),
    pairs: overlapPairs(map.items.map(toPlaced)),
  };
}

function renderChecks(items: EditorItem[]) {
  const map = doc(items);
  const onGo = vi.fn();
  render(<ChecksBar doc={map} flags={flagsOf(map)} onGo={onGo} />);
  return { onGo };
}

const bar = () => screen.getByRole('group', { name: 'בדיקות המפה' });

describe('the checks bar', () => {
  it('says הכול תקין on an empty map, and offers nothing to press', () => {
    renderChecks([]);
    expect(screen.getByText('הכול תקין')).toBeTruthy();
    expect(bar().querySelectorAll('button')).toHaveLength(0);
  });

  it('counts the items past the fence when every one of them is, and each press goes to the next', () => {
    const { onGo } = renderChecks([
      item({ id: 'a', xCm: 3000, yCm: 0 }),
      item({ id: 'b', label: 'אוהל 2', xCm: -500 }),
      item({ id: 'c', label: 'אוהל 3', yCm: 2600 }),
    ]);
    const chip = screen.getByRole('button', { name: '3 מחוץ לגדר' });
    for (let press = 0; press < 4; press += 1) fireEvent.click(chip);
    expect(onGo.mock.calls.map((call) => call[0])).toEqual([['a'], ['b'], ['c'], ['a']]);
    expect(screen.queryByText('הכול תקין')).toBeNull();
  });

  it('counts one overlap in words, and goes to the pair', () => {
    const { onGo } = renderChecks([
      item({ id: 'a' }),
      item({ id: 'b', label: 'אוהל 2', xCm: 600, yCm: 550 }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'חפיפה אחת' }));
    expect(onGo).toHaveBeenCalledWith(['a', 'b']);
  });

  it('counts what sits in a net’s unshaded strip', () => {
    const { onGo } = renderChecks([
      item({ id: 'n', kind: 'shade', label: 'רשת צל 1', xCm: 0, yCm: 0, widthCm: 800, depthCm: 800, insetCm: 50 }),
      item({ id: 's', kind: 'sofa', label: 'ספה 1', xCm: 20, yCm: 100, widthCm: 200, depthCm: 90 }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: '1 בשולי רשת צל' }));
    expect(onGo).toHaveBeenCalledWith(['s']);
  });

  it('says הכול תקין when everything is inside and apart', () => {
    renderChecks([item({ id: 'a' }), item({ id: 'b', label: 'אוהל 2', xCm: 1200 })]);
    expect(screen.getByText('הכול תקין')).toBeTruthy();
  });
});
