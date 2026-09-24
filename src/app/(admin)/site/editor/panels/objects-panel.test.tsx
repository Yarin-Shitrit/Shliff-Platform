/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { derive, toPlaced } from '@/lib/site/derive';
import { overlapPairs } from '@/lib/site/geometry';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import { ObjectsPanel } from './objects-panel';
import { SidePanel } from './side-panel';

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

function renderList(items: EditorItem[], over: { selection?: string[]; hiddenGroups?: Array<'sleep'> } = {}) {
  const map = doc(items);
  const onPick = vi.fn();
  const onToggleGroup = vi.fn();
  render(
    <ObjectsPanel
      items={map.items}
      selection={over.selection ?? []}
      flags={flagsOf(map)}
      hiddenGroups={over.hiddenGroups ?? []}
      onPick={onPick}
      onToggleGroup={onToggleGroup}
    />,
  );
  return { onPick, onToggleGroup };
}

const rows = () => screen.getAllByRole('button').filter((button) => button.dataset.row === 'true');

describe('the list of what is on the map', () => {
  it('lists every item under its group, in the order a person counts, with its size', () => {
    renderList([
      item({ id: 't10', label: 'אוהל 10' }),
      item({ id: 't2', label: 'אוהל 2', xCm: 900 }),
      item({ id: 'k', kind: 'kitchen', label: 'מטבח 1', xCm: 1500, widthCm: 400, depthCm: 300 }),
    ]);
    expect(rows().map((row) => row.getAttribute('aria-label')))
      .toEqual(['אוהל 2, 3 × 2 מ׳', 'אוהל 10, 3 × 2 מ׳', 'מטבח 1, 4 × 3 מ׳']);
    expect(screen.getByText('לינה וצל')).toBeTruthy();
    expect(screen.getByText('מגורים')).toBeTruthy();
  });

  it('says in words which rows have a problem, and which are locked', () => {
    renderList([
      item({ id: 'out', label: 'קראוון 1', kind: 'caravan', xCm: 2500, widthCm: 700, depthCm: 250 }),
      item({ id: 'lk', label: 'אוהל 3', xCm: 1200, locked: true }),
    ]);
    expect(screen.getByRole('button', { name: 'קראוון 1, מחוץ לגדר, 7 × 2.5 מ׳' })).toBeTruthy();
    // Ruling P11: a noun phrase, never an adjective that agrees with the item's name.
    expect(screen.getByRole('button', { name: 'אוהל 3, בנעילה, 3 × 2 מ׳' })).toBeTruthy();
  });

  it('picks a row, and adds it with shift or ⌘', () => {
    const { onPick } = renderList([item({ id: 'a' })]);
    fireEvent.click(rows()[0]);
    expect(onPick).toHaveBeenLastCalledWith('a', false);
    fireEvent.click(rows()[0], { shiftKey: true });
    expect(onPick).toHaveBeenLastCalledWith('a', true);
    fireEvent.click(rows()[0], { metaKey: true });
    expect(onPick).toHaveBeenLastCalledWith('a', true);
  });

  it('hides and shows a group with one switch', () => {
    const { onToggleGroup } = renderList([item({ id: 'a' })], { hiddenGroups: ['sleep'] });
    const eye = screen.getByRole('button', { name: 'הסתרת לינה וצל' });
    expect(eye.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(eye);
    expect(onToggleGroup).toHaveBeenCalledWith('sleep');
  });

  it('finds an item by name, and says when there is none', () => {
    renderList([item({ id: 'a' }), item({ id: 'b', label: 'ספה 1', kind: 'sofa', xCm: 1200 })]);
    const search = screen.getByRole('searchbox', { name: 'חיפוש במפה' });
    fireEvent.change(search, { target: { value: 'ספה' } });
    expect(rows().map((row) => row.dataset.id)).toEqual(['b']);
    fireEvent.change(search, { target: { value: 'חללית' } });
    expect(screen.getByText('אין במפה פריט בשם הזה.')).toBeTruthy();
  });

  it('invites the first item on an empty map', () => {
    renderList([]);
    expect(screen.getByText('המפה ריקה. בלשונית ״הוספה למפה״ גוררים פריט אל המפה או לוחצים עליו.')).toBeTruthy();
  });
});

describe('the side panel', () => {
  function renderSide(count: number, tab: 'library' | 'objects' = 'library') {
    const onTab = vi.fn();
    render(<SidePanel tab={tab} onTab={onTab} count={count} library={<p>הספרייה</p>} objects={<p>הרשימה</p>} />);
    return { onTab };
  }

  it('shows one tab at a time and counts what is on the map', () => {
    const { onTab } = renderSide(12);
    expect(screen.getByRole('tab', { name: 'הוספה למפה' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('הספרייה')).toBeTruthy();
    expect(screen.queryByText('הרשימה')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'במפה 12' }));
    expect(onTab).toHaveBeenCalledWith('objects');
  });

  it('says how the first item is placed when the map is empty', () => {
    renderSide(0);
    expect(screen.getByText('המפה ריקה. גרירה של פריט אל המפה מניחה אותו בדיוק שם; לחיצה מניחה אותו במקום פנוי במרכז התצוגה.')).toBeTruthy();
  });

  it('moves between the tabs with the arrows, and keeps them from nudging the map', () => {
    const { onTab } = renderSide(3);
    const tab = screen.getByRole('tab', { name: 'הוספה למפה' });
    const press = createEvent.keyDown(tab, { key: 'ArrowLeft', code: 'ArrowLeft' });
    fireEvent(tab, press);
    expect(onTab).toHaveBeenCalledWith('objects');
    expect(press.defaultPrevented).toBe(true);
  });
});
