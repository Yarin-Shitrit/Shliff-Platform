/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { EditorDoc, EditorItem, EditorLine } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import { ItemInspector } from './inspector-item';

/** The split offer in the item inspector: tick two or more consumers, connect them through a splitter. */

function item(over: Partial<EditorItem> & { id: string; kind: EditorItem['kind']; label: string }): EditorItem {
  return {
    xCm: 0, yCm: 0, widthCm: 100, depthCm: 100, heightCm: null, insetCm: null, ropeAngleDeg: null,
    sort: 0, taskId: null, notes: null, facing: 0, locked: false, ...over,
  };
}
const TANK = item({ id: 'tank', kind: 'water', label: 'מי שתייה 1' });
const S1 = item({ id: 's1', kind: 'shower', label: 'מקלחת 1', xCm: 1000 });
const S2 = item({ id: 's2', kind: 'shower', label: 'מקלחת 2', xCm: 1000, yCm: 1000 });
const SINK = item({ id: 'sink', kind: 'sink', label: 'כיור 1', xCm: 1000, yCm: 500 });
const NO_FLAGS: EditorFlags = { outside: new Set(), overlapping: new Set(), partly: new Set(), pairs: [], onRopes: new Set(), ropePairs: [] };

function renderFor(shown: EditorItem, items: EditorItem[], lines: EditorLine[] = []) {
  const doc: EditorDoc = { plot: { id: 'p', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, lines, defaults: {} };
  const onSplit = vi.fn();
  render(<ItemInspector doc={doc} item={shown} flags={NO_FLAGS} buildTasks={[]} onRun={vi.fn()} onPickIds={vi.fn()} onAddLine={vi.fn()} onSplit={onSplit} />);
  return { onSplit };
}

describe('splitting from a tank', () => {
  it('offers every unreached consumer as a tick, and connects the ticked ones through a splitter', () => {
    const { onSplit } = renderFor(TANK, [TANK, S1, S2, SINK]);
    const group = screen.getByRole('group', { name: 'פיצול מים לכמה פריטים' });
    expect(group).toBeTruthy();
    const button = screen.getByRole('button', { name: 'חיבור דרך מפצל' });
    expect(button).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByLabelText('מקלחת 1'));
    fireEvent.click(screen.getByLabelText('כיור 1'));
    fireEvent.click(screen.getByRole('button', { name: 'חיבור דרך מפצל (2)' }));
    expect(onSplit).toHaveBeenCalledWith('water', 'tank', ['s1', 'sink']);
    expect(screen.getByText(/סך הצינורות הכי קצר/)).toBeTruthy();
  });

  it('offers no split with a single consumer left, and none from a shower', () => {
    renderFor(TANK, [TANK, S1, S2], [{ id: 'l', kind: 'water', label: 'צינור מים 1', fromId: 'tank', toId: 's2', points: [], sort: 0, notes: null }]);
    expect(screen.queryByRole('group', { name: 'פיצול מים לכמה פריטים' })).toBeNull();
    renderFor(S1, [TANK, S1, S2, SINK]);
    expect(screen.queryByRole('group', { name: 'פיצול מים לכמה פריטים' })).toBeNull();
  });
});
