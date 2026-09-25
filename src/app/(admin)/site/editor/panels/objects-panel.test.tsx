/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { derive, toPlaced } from '@/lib/site/derive';
import { overlapPairs } from '@/lib/site/geometry';
import type { SiteKindGroup } from '@/lib/site/kinds';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import { EMPTY_MAP } from '../notices';
import { ObjectsPanel } from './objects-panel';
import { SidePanel, type SideTab } from './side-panel';

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

function renderList(items: EditorItem[], over: {
  selection?: string[];
  hiddenGroups?: SiteKindGroup[];
  netsHidden?: boolean;
  onShowLibrary?: () => void;
} = {}) {
  const map = doc(items);
  const onPick = vi.fn();
  const onPickIds = vi.fn<(ids: string[]) => void>();
  const onToggleGroup = vi.fn();
  const { unmount } = render(
    <ObjectsPanel
      items={map.items}
      selection={over.selection ?? []}
      flags={flagsOf(map)}
      hiddenGroups={over.hiddenGroups ?? []}
      netsHidden={over.netsHidden ?? false}
      onPick={onPick}
      onPickIds={onPickIds}
      onToggleGroup={onToggleGroup}
      onShowLibrary={over.onShowLibrary}
    />,
  );
  return { onPick, onPickIds, onToggleGroup, unmount };
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

  it('names every problem a row has, not only the first', () => {
    renderList([
      // A net whose shaded ground is (0.5 m, 0.5 m)–(7.5 m, 7.5 m).
      item({ id: 's', kind: 'shade', label: 'רשת צל 1', xCm: 0, yCm: 0, widthCm: 800, depthCm: 800, insetCm: 50 }),
      // In the net's sag strip, and under the kitchen's corner.
      item({ id: 'p', label: 'אוהל 1', xCm: 700, yCm: 100 }),
      item({ id: 'k', kind: 'kitchen', label: 'מטבח 1', xCm: 900, yCm: 100, widthCm: 400, depthCm: 300 }),
      // Across the fence, and on a tent flush against it.
      item({ id: 'c', kind: 'caravan', label: 'קראוון 1', xCm: 2500, widthCm: 700, depthCm: 250 }),
      item({ id: 't', label: 'אוהל 2', xCm: 2300 }),
    ]);
    expect(screen.getByRole('button', { name: 'אוהל 1, חפיפה עם פריט אחר, בשולי רשת צל, 3 × 2 מ׳' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'קראוון 1, מחוץ לגדר, חפיפה עם פריט אחר, 7 × 2.5 מ׳' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'אוהל 2, חפיפה עם פריט אחר, 3 × 2 מ׳' })).toBeTruthy();
    // The dot takes the worst tone among them.
    const caravan = screen.getByRole('button', { name: /^קראוון 1,/ });
    expect(caravan.querySelector('[data-tone]')?.getAttribute('data-tone')).toBe('bad');
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

  it('marks the rows of a hidden group, and a net’s row while the nets are hidden, in words', () => {
    const net = item({ id: 's', kind: 'shade', label: 'רשת צל 1', xCm: 1200, widthCm: 800, depthCm: 800, insetCm: 50 });
    const kitchen = item({ id: 'k', kind: 'kitchen', label: 'מטבח 1', xCm: 500, yCm: 1500, widthCm: 400, depthCm: 300 });
    const { unmount } = renderList([item({ id: 'a' }), kitchen], { hiddenGroups: ['sleep'] });
    const tent = screen.getByRole('button', { name: 'אוהל 1, בהסתרה, 3 × 2 מ׳' });
    expect(tent.dataset.hidden).toBe('true');
    // A group that is shown is not marked.
    const shown = screen.getByRole('button', { name: 'מטבח 1, 4 × 3 מ׳' });
    expect(shown.dataset.hidden).toBeUndefined();
    unmount();

    renderList([item({ id: 'a' }), net], { netsHidden: true });
    expect(screen.getByRole('button', { name: 'רשת צל 1, בהסתרה, 8 × 8 מ׳' }).dataset.hidden).toBe('true');
    expect(screen.getByRole('button', { name: 'אוהל 1, 3 × 2 מ׳' }).dataset.hidden).toBeUndefined();
  });

  it('selects exactly the rows a group counts, and during a search only the ones found', () => {
    const { onPickIds } = renderList([
      item({ id: 't10', label: 'אוהל 10' }),
      item({ id: 't2', label: 'אוהל 2', xCm: 900 }),
      item({ id: 's', kind: 'shade', label: 'רשת צל 1', xCm: 1200, widthCm: 800, depthCm: 800, insetCm: 50 }),
      item({ id: 'k', kind: 'kitchen', label: 'מטבח 1', xCm: 500, yCm: 1500, widthCm: 400, depthCm: 300 }),
    ]);
    // Label-in-name (ruling G1, integration II): the name carries the number the button shows.
    const count = (n: number) => screen.getByRole('button', { name: `בחירת הפריטים בקבוצה לינה וצל (${n})` });
    const picked = (): string[] => {
      const call = onPickIds.mock.lastCall;
      if (call === undefined) throw new Error('the count selected nothing');
      return call[0];
    };

    fireEvent.click(count(3));
    expect(picked()).toEqual(['t2', 't10', 's']);
    // The number on the button is the set it selects.
    expect(count(3).textContent).toBe(String(picked().length));
    fireEvent.click(screen.getByRole('button', { name: 'בחירת הפריטים בקבוצה מגורים (1)' }));
    expect(picked()).toEqual(['k']);

    fireEvent.change(screen.getByRole('searchbox', { name: 'חיפוש במפה' }), { target: { value: 'אוהל' } });
    fireEvent.click(count(2));
    expect(picked()).toEqual(['t2', 't10']);
    expect(count(2).textContent).toBe(String(picked().length));
  });

  it('finds an item by name, and when there is none offers the whole list back', () => {
    renderList([item({ id: 'a' }), item({ id: 'b', label: 'ספה 1', kind: 'sofa', xCm: 1200 })]);
    const search = screen.getByRole('searchbox', { name: 'חיפוש במפה' }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'ספה' } });
    expect(rows().map((row) => row.dataset.id)).toEqual(['b']);
    fireEvent.change(search, { target: { value: 'חללית' } });
    expect(screen.getByText('אין במפה פריט בשם הזה. אפשר לחפש בשם אחר, או לחזור לכל הרשימה.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ניקוי החיפוש' }));
    expect(search.value).toBe('');
    expect(rows().map((row) => row.dataset.id)).toEqual(['a', 'b']);
    // The button is gone with the empty result; the search box keeps the focus.
    expect(document.activeElement).toBe(search);
  });

  it('invites the first item on an empty map, with a way to the library', () => {
    const onShowLibrary = vi.fn();
    const { unmount } = renderList([], { onShowLibrary });
    expect(screen.getByText(EMPTY_MAP)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'מעבר להוספה למפה' }));
    expect(onShowLibrary).toHaveBeenCalledTimes(1);
    unmount();

    // Without a way to get there, the panel offers none.
    renderList([]);
    expect(screen.queryByRole('button', { name: 'מעבר להוספה למפה' })).toBeNull();
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

  it('invites the first item when the map is empty, and leaves how to place it to the library', () => {
    renderSide(0);
    expect(screen.getByText(EMPTY_MAP)).toBeTruthy();
    // The library says how a tile is placed; the panel does not say it a second time.
    expect(screen.queryByText(/גרירה|לחיצה/)).toBeNull();
  });

  it('keeps the focus when a control inside a tab opens the other one', () => {
    function Harness() {
      const [tab, setTab] = useState<SideTab>('objects');
      return (
        <SidePanel
          tab={tab}
          onTab={setTab}
          count={0}
          library={<p>הספרייה</p>}
          objects={<button type="button" onClick={() => { setTab('library'); }}>מעבר להוספה למפה</button>}
        />
      );
    }
    render(<Harness />);
    const go = screen.getByRole('button', { name: 'מעבר להוספה למפה' });
    go.focus();
    fireEvent.click(go);
    // The button went with its tab; the focus lands on the tab it opened, not on the page.
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'הוספה למפה' }));
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
