/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import { applyOps, type SiteOp } from '@/lib/site/editor/ops';
import { NOT_A_LENGTH } from '@/lib/site/editor/metres';
import { MultiInspector } from './inspector-multi';

/* This file's own fixture: two tents that differ in width, and a caravan. */
function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 500, yCm: 500, widthCm: 300, depthCm: 200,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

const T1 = item({ id: 't1' });
const T2 = item({ id: 't2', label: 'אוהל 2', xCm: 1000, widthCm: 350 });
const C = item({ id: 'c', kind: 'caravan', label: 'קראוון 1', xCm: 500, yCm: 1000, widthCm: 700, depthCm: 250 });

function renderMulti(items: EditorItem[]) {
  const map: EditorDoc = {
    plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, defaults: {},
  };
  const onRun = vi.fn<(label: string, ops: SiteOp[]) => void>();
  const onPickIds = vi.fn();
  const onClear = vi.fn();
  render(
    <MultiInspector
      doc={map}
      ids={items.map((entry) => entry.id)}
      onRun={onRun}
      onPickIds={onPickIds}
      onClear={onClear}
    />,
  );
  const after = () => {
    const call = onRun.mock.lastCall;
    if (call === undefined) throw new Error('nothing was run');
    return applyOps(map, call[1]).doc;
  };
  return { onRun, onPickIds, onClear, after };
}

const widths = () => screen.getAllByLabelText('רוחב') as HTMLInputElement[];
const byId = (items: EditorItem[], id: string) => items.find((entry) => entry.id === id);

describe('several items', () => {
  it('names what is selected, per kind — each a chip that selects its kind — and says it was typed by hand', () => {
    const { onPickIds } = renderMulti([T1, T2, C]);
    expect(screen.getByRole('heading', { name: 'נבחרו 3 פריטים' })).toBeTruthy();
    // Ruling P9: a figure selects what it counts.
    fireEvent.click(screen.getByRole('button', { name: '2 אוהלים' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['t1', 't2']);
    fireEvent.click(screen.getByRole('button', { name: '1 קראוון' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['c']);
    expect(screen.getByRole('img', { name: 'מקור: נרשם ידנית' })).toBeTruthy();
  });

  it('shows a size the tents share, and מעורב — never a number — where they differ', () => {
    renderMulti([T1, T2, C]);
    const [tentWidth, caravanWidth] = widths();
    expect(tentWidth.value).toBe('');
    expect(tentWidth.placeholder).toBe('מעורב');
    expect((screen.getAllByLabelText('עומק')[0] as HTMLInputElement).value).toBe('2');
    expect(caravanWidth.value).toBe('7');
  });

  /* Ruling P13: "ברירת מחדל" marks a kind whose selected items have no height of their own. */
  it('marks the height as the kind’s where no item of that kind has its own', () => {
    renderMulti([T1, T2, C]);
    expect(screen.getAllByText('גובה ברירת מחדל')).toHaveLength(2);
  });

  it('does not mark a height one of the items holds as its own, even when it equals the kind’s', () => {
    renderMulti([T1, item({ id: 't2', label: 'אוהל 2', xCm: 1000, heightCm: 200 })]);
    expect((screen.getByLabelText('גובה') as HTMLInputElement).value).toBe('2');
    expect(screen.queryByText('גובה ברירת מחדל')).toBeNull();
  });

  it('applies a typed width to every tent in the selection, each about its own middle', () => {
    const { after } = renderMulti([T1, T2, C]);
    fireEvent.change(widths()[0], { target: { value: '4' } });
    fireEvent.keyDown(widths()[0], { key: 'Enter' });
    const items = after().items;
    expect(byId(items, 't1')).toMatchObject({ widthCm: 400, xCm: 450 });
    expect(byId(items, 't2')).toMatchObject({ widthCm: 400, xCm: 975 });
    expect(byId(items, 'c')).toMatchObject({ widthCm: 700, xCm: 500 });
  });

  it('refuses a width that is not one, in Hebrew', () => {
    const { onRun } = renderMulti([T1, T2]);
    fireEvent.change(widths()[0], { target: { value: 'abc' } });
    fireEvent.keyDown(widths()[0], { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe(NOT_A_LENGTH);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('stores no default while the tents differ, and says why', () => {
    const { onRun } = renderMulti([T1, T2]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'לשמור גם כברירת המחדל של אוהל' }));
    expect(screen.getByText('המידות של אוהלים בבחירה שונות זו מזו. ברירת המחדל תישמר כשיהיה להן ערך אחד.')).toBeTruthy();
    expect(onRun).not.toHaveBeenCalled();
  });

  it('stores the default the tents agree on', () => {
    const { after } = renderMulti([T1, item({ id: 't2', label: 'אוהל 2', xCm: 1000 })]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'לשמור גם כברירת המחדל של אוהל' }));
    expect(after().defaults.tent).toEqual({ widthCm: 300, depthCm: 200, heightCm: 200, insetCm: null });
  });

  it('aligns two or more, and distributes only three or more', () => {
    const { after } = renderMulti([T1, T2, C]);
    const spread = screen.getByRole('button', { name: 'פיזור שווה, מזרח־מערב' }) as HTMLButtonElement;
    expect(spread.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'יישור לקצה המערבי' }));
    expect(after().items.map((entry) => entry.xCm)).toEqual([500, 500, 500]);
  });

  it('keeps distribution off for two', () => {
    renderMulti([T1, T2]);
    const spread = screen.getByRole('button', { name: 'פיזור שווה, מזרח־מערב' }) as HTMLButtonElement;
    expect(spread.disabled).toBe(true);
  });

  it('arranges a row with the typed gap, and refuses a gap that is not a length', () => {
    const { after, onRun } = renderMulti([T1, T2, C]);
    const gap = screen.getByLabelText('מרווח בשורה') as HTMLInputElement;
    fireEvent.change(gap, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'סידור בשורה' }));
    const row = [...after().items].sort((a, b) => a.xCm - b.xCm);
    for (let index = 1; index < row.length; index += 1) {
      expect(row[index].xCm).toBe(row[index - 1].xCm + row[index - 1].widthCm + 100);
      expect(row[index].yCm).toBe(row[0].yCm);
    }
    onRun.mockClear();
    fireEvent.change(gap, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'סידור בשורה' }));
    expect(screen.getByRole('alert').textContent).toBe(NOT_A_LENGTH);
    expect(onRun).not.toHaveBeenCalled();
  });
});
