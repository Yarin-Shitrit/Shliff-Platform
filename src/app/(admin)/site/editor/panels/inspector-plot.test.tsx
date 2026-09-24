/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { derive, toPlaced } from '@/lib/site/derive';
import { overlapPairs } from '@/lib/site/geometry';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import { PlotInspector } from './inspector-plot';
import { northText } from './north';

/* This file's own fixture. */
function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 500, yCm: 500, widthCm: 300, depthCm: 200,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

function doc(items: EditorItem[], northDeg = 0): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg }, items, defaults: {} };
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

const HREF = '/site?season=s26&act=plot';

function renderPlot(map: EditorDoc) {
  const onPickIds = vi.fn();
  render(<PlotInspector doc={map} flags={flagsOf(map)} plotHref={HREF} onPickIds={onPickIds} />);
  return { onPickIds };
}

describe('the plot, when nothing is selected', () => {
  it('gives the plot’s figures, each a link to the drawer that changes it, and says they were typed by hand', () => {
    renderPlot(doc([]));
    expect(screen.getByRole('link', { name: '26 × 24 מ׳' }).getAttribute('href')).toBe(HREF);
    // Ruling P10: the area is the plot's size multiplied out, so it goes to the same drawer.
    expect(screen.getByRole('link', { name: '624 מ״ר' }).getAttribute('href')).toBe(HREF);
    expect(screen.getByRole('link', { name: '0.5 מ׳' }).getAttribute('href')).toBe(HREF);
    expect(screen.getByRole('link', { name: 'הצפון למעלה במפה' }).getAttribute('href')).toBe(HREF);
    expect(screen.getByRole('img', { name: 'מקור: נרשם ידנית' })).toBeTruthy();
  });

  it('invites the first item and the first net on an empty map, and finds nothing wrong with it', () => {
    renderPlot(doc([]));
    expect(screen.getByText('המפה ריקה. גרירה של פריט מהספרייה אל המפה, או לחיצה עליו, מניחה את הראשון.')).toBeTruthy();
    expect(screen.getByText('הכול בתוך הגדר, ושום דבר לא יושב על משהו אחר.')).toBeTruthy();
    // Ruling P10: with no nets, an invitation rather than a statement.
    expect(screen.getByText('אין עדיין רשתות צל. גרירה של רשת צל מהספרייה תוסיף אחת.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /פריטים/ })).toBeNull();
  });

  it('counts each group, and a count selects its group', () => {
    const { onPickIds } = renderPlot(doc([
      item({ id: 'a' }),
      item({ id: 'b', label: 'אוהל 2', xCm: 1000 }),
      item({ id: 's', kind: 'sofa', label: 'ספה 1', xCm: 1500, widthCm: 200, depthCm: 90 }),
    ]));
    fireEvent.click(screen.getByRole('button', { name: 'לינה וצל 2' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['a', 'b']);
    fireEvent.click(screen.getByRole('button', { name: 'מגורים 1' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['s']);
    fireEvent.click(screen.getByRole('button', { name: '3 פריטים' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['a', 'b', 's']);
  });

  it('lists every problem as a row that selects what it names, and the shade the nets give selects the nets', () => {
    const { onPickIds } = renderPlot(doc([
      item({ id: 'n', kind: 'shade', label: 'רשת צל 1', xCm: 0, yCm: 0, widthCm: 800, depthCm: 800, insetCm: 50 }),
      item({ id: 's', kind: 'sofa', label: 'ספה 1', xCm: 20, yCm: 100, widthCm: 200, depthCm: 90 }),
      item({ id: 'a', label: 'אוהל 1', xCm: 2500 }),
      item({ id: 'b', label: 'אוהל 2', xCm: 1000, yCm: 1000 }),
      item({ id: 'c', label: 'אוהל 3', xCm: 1100, yCm: 1050 }),
    ]));
    fireEvent.click(screen.getByRole('button', { name: 'מחוץ לגדר: אוהל 1' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['a']);
    fireEvent.click(screen.getByRole('button', { name: 'חפיפה: אוהל 2 · אוהל 3' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['b', 'c']);
    fireEvent.click(screen.getByRole('button', { name: 'בשולי רשת צל: ספה 1' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['s']);
    expect(screen.getByText('49 מ״ר')).toBeTruthy();
    // Ruling P10: the shade figures are the nets' — each selects them.
    onPickIds.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'שטח בצל 49 מ״ר' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['n']);
    onPickIds.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'רשתות צל 1' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['n']);
    expect(screen.queryByText('אין עדיין רשתות צל. גרירה של רשת צל מהספרייה תוסיף אחת.')).toBeNull();
  });

  it('says which way north is, in words a lead can check against the sun', () => {
    expect(northText(0)).toBe('הצפון למעלה במפה');
    expect(northText(45)).toBe('למעלה במפה פונה לצפון־מזרח (45°)');
    expect(northText(90)).toBe('למעלה במפה פונה למזרח (90°)');
    expect(northText(200)).toBe('למעלה במפה פונה לדרום (200°)');
    expect(northText(359)).toBe('למעלה במפה פונה לצפון (359°)');
    renderPlot(doc([], 90));
    expect(screen.getByRole('link', { name: 'למעלה במפה פונה למזרח (90°)' }).getAttribute('href')).toBe(HREF);
  });
});
