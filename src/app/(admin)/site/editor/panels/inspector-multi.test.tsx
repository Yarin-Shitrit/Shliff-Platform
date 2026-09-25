/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import { applyOps, type SiteOp } from '@/lib/site/editor/ops';
import { NOT_A_LENGTH } from '@/lib/site/editor/metres';
import { LOCKED_ALL_NOTICE } from '../notices';
import { MultiInspector } from './inspector-multi';

/* This file's own fixture: two tents that differ in width, and a caravan. */
function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 500, yCm: 500, widthCm: 300, depthCm: 200,
    heightCm: null, insetCm: null, ropeAngleDeg: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

const T1 = item({ id: 't1' });
const T2 = item({ id: 't2', label: 'אוהל 2', xCm: 1000, widthCm: 350 });
const C = item({ id: 'c', kind: 'caravan', label: 'קראוון 1', xCm: 500, yCm: 1000, widthCm: 700, depthCm: 250 });

function renderMulti(items: EditorItem[]) {
  const map: EditorDoc = {
    plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, lines: [], defaults: {},
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

  it('refuses a width that is not one, in Hebrew, and names the box that was refused', () => {
    const { onRun } = renderMulti([T1, T2]);
    const depth = screen.getByLabelText('עומק') as HTMLInputElement;
    const height = screen.getByLabelText('גובה') as HTMLInputElement;
    fireEvent.change(widths()[0], { target: { value: 'abc' } });
    fireEvent.keyDown(widths()[0], { key: 'Enter' });
    let alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(`רוחב: ${NOT_A_LENGTH}`);
    expect(alert.id).not.toBe('');
    expect(widths()[0].getAttribute('aria-invalid')).toBe('true');
    expect(widths()[0].getAttribute('aria-describedby')).toBe(alert.id);
    for (const other of [depth, height]) {
      expect(other.getAttribute('aria-invalid')).toBeNull();
      expect(other.getAttribute('aria-describedby')).toBeNull();
    }

    // The width emptied and a depth refused: the refusal moves to the depth.
    fireEvent.change(widths()[0], { target: { value: '' } });
    fireEvent.change(depth, { target: { value: '0' } });
    fireEvent.keyDown(depth, { key: 'Enter' });
    alert = screen.getByRole('alert');
    // `readMetres` isolates each number with U+2066…U+2069; read past them.
    expect((alert.textContent ?? '').replace(/[⁦-⁩]/g, '')).toBe('עומק: צריך מספר בין 0.1 ל־500 מטר');
    expect(depth.getAttribute('aria-invalid')).toBe('true');
    expect(depth.getAttribute('aria-describedby')).toBe(alert.id);
    expect(widths()[0].getAttribute('aria-invalid')).toBeNull();
    expect(onRun).not.toHaveBeenCalled();
  });

  /* Fix round 1: typing the kind's height means the kind's height here too, as in ItemInspector (P13). */
  it('puts tents back on the kind’s height when it is typed, and leaves a locked one as it is', () => {
    const { after } = renderMulti([
      item({ id: 't1', heightCm: 250 }),
      item({ id: 't2', label: 'אוהל 2', xCm: 1000, heightCm: 250 }),
      item({ id: 't3', label: 'אוהל 3', xCm: 1500, heightCm: 200 }),
      item({ id: 't4', label: 'אוהל 4', xCm: 2000, heightCm: 250, locked: true }),
    ]);
    const height = screen.getByLabelText('גובה') as HTMLInputElement;
    fireEvent.change(height, { target: { value: '2' } });
    fireEvent.keyDown(height, { key: 'Enter' });
    const items = after().items;
    expect(byId(items, 't1')).toMatchObject({ heightCm: null, widthCm: 300, xCm: 500 });
    expect(byId(items, 't2')?.heightCm).toBeNull();
    expect(byId(items, 't3')?.heightCm).toBeNull();
    expect(byId(items, 't4')).toMatchObject({ heightCm: 250, locked: true });
  });

  it('isolates each chip’s count, so the number keeps its place in a right-to-left line', () => {
    renderMulti([T1, T2, C]);
    expect(screen.getByRole('button', { name: '2 אוהלים' }).querySelector('bdi')?.textContent).toBe('2');
    expect(screen.getByRole('button', { name: '1 קראוון' }).querySelector('bdi')?.textContent).toBe('1');
  });

  it('keeps the sizes of a kind whose selected items are all locked from being typed', () => {
    renderMulti([
      item({ id: 't1', locked: true }),
      item({ id: 't2', label: 'אוהל 2', xCm: 1000, locked: true }),
      C,
    ]);
    for (const name of ['רוחב', 'עומק', 'גובה']) {
      const [tentBox, caravanBox] = screen.getAllByLabelText(name) as HTMLInputElement[];
      expect(tentBox.disabled).toBe(true);
      expect(caravanBox.disabled).toBe(false);
    }
  });

  it('says how many of the selection are locked, and does not align what is left when it is one', () => {
    renderMulti([
      item({ id: 't1', locked: true }),
      item({ id: 't2', label: 'אוהל 2', xCm: 1000, locked: true }),
      C,
    ]);
    expect(screen.getByText('2 פריטים בבחירה נעולים ולא ישתנו.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'יישור לקצה המערבי' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'סידור בשורה' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('with one of three locked, aligns the other two, distributes nothing, and leaves the kind’s sizes open', () => {
    const { after } = renderMulti([item({ id: 't1', xCm: 200, locked: true }), T2, C]);
    expect(screen.getByText('פריט אחד בבחירה נעול ולא ישתנה.')).toBeTruthy();
    expect(widths()[0].disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'פיזור שווה, מזרח־מערב' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'יישור לקצה המערבי' }));
    const items = after().items;
    expect(byId(items, 't1')?.xCm).toBe(200);
    expect(byId(items, 't2')?.xCm).toBe(500);
    expect(byId(items, 'c')?.xCm).toBe(500);
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
    expect(after().defaults.tent).toEqual({ widthCm: 300, depthCm: 200, heightCm: 200, insetCm: null, ropeAngleDeg: null });
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

  /* Review minor: with every selected item locked, the way back to the
     default sizes, or Enter in the gap box, did nothing — and said nothing. */
  it('says why nothing happened when every selected item is locked', () => {
    const { onRun } = renderMulti([
      item({ id: 't1', locked: true, widthCm: 350 }),
      item({ id: 't2', label: 'אוהל 2', xCm: 1000, locked: true }),
    ]);
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'החזרת הנבחרים למידות ברירת המחדל' }));
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe(LOCKED_ALL_NOTICE);
  });

  it('says it for Enter in the gap box too, and nothing when an edit simply changes nothing', () => {
    const locked = renderMulti([
      item({ id: 't1', locked: true }),
      item({ id: 't2', label: 'אוהל 2', xCm: 1000, locked: true }),
    ]);
    fireEvent.keyDown(screen.getByLabelText('מרווח בשורה'), { key: 'Enter' });
    expect(locked.onRun).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe(LOCKED_ALL_NOTICE);
    cleanup();

    // Free tents already at the kind's size (3 × 3 m): nothing to change, and nothing to explain.
    const free = renderMulti([
      item({ id: 't1', depthCm: 300 }),
      item({ id: 't2', label: 'אוהל 2', xCm: 1000, depthCm: 300 }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'החזרת הנבחרים למידות ברירת המחדל' }));
    expect(free.onRun).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
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
