/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { derive, toPlaced } from '@/lib/site/derive';
import { overlapPairs } from '@/lib/site/geometry';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import { applyOps, type SiteOp } from '@/lib/site/editor/ops';
import { NOT_A_LENGTH } from '@/lib/site/editor/metres';
import { LABEL_REQUIRED } from '../../failure-messages';
import type { EditorFlags } from '../use-editor-store';
import { LOCKED_NOTICE } from '../notices';
import { ItemInspector } from './inspector-item';

/* This file's own fixture. */
function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 500, yCm: 500, widthCm: 300, depthCm: 200,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

function doc(items: EditorItem[]): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, lines: [], defaults: {} };
}

function flagsOf(map: EditorDoc): EditorFlags {
  const { items } = derive(map.plot, map.items);
  return {
    outside: new Set(items.filter((entry) => entry.outside).map((entry) => entry.id)),
    overlapping: new Set(items.filter((entry) => entry.overlapping).map((entry) => entry.id)),
    partly: new Set(items.filter((entry) => entry.shade === 'partly').map((entry) => entry.id)),
    pairs: overlapPairs(map.items.map(toPlaced)),
  };
}

function renderItem(over: Partial<EditorItem> = {}, others: EditorItem[] = []) {
  const shown = item({ id: 'a', ...over });
  const map = doc([shown, ...others]);
  const onRun = vi.fn<(label: string, ops: SiteOp[]) => void>();
  const onPickIds = vi.fn();
  render(
    <ItemInspector
      doc={map}
      item={shown}
      flags={flagsOf(map)}
      buildTasks={[{ id: 't1', title: 'הקמת הצל' }]}
      onRun={onRun}
      onPickIds={onPickIds}
    />,
  );
  /** What the store would hold after the edit — `applyOps`, the rule the store uses. */
  const after = () => {
    const call = onRun.mock.lastCall;
    if (call === undefined) throw new Error('nothing was run');
    return applyOps(map, call[1]).doc;
  };
  return { onRun, onPickIds, after };
}

const box = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

function type(name: string, text: string): void {
  fireEvent.change(box(name), { target: { value: text } });
  fireEvent.keyDown(box(name), { key: 'Enter' });
}

describe('one item', () => {
  it('shows it in metres, says the height is its kind’s, and says it was typed by hand', () => {
    renderItem();
    expect(screen.getByRole('heading', { name: 'אוהל 1' })).toBeTruthy();
    expect(box('רוחב').value).toBe('3');
    expect(box('עומק').value).toBe('2');
    expect(box('גובה').value).toBe('');
    expect(box('גובה').placeholder).toBe('2');
    expect(screen.getByText('גובה ברירת מחדל')).toBeTruthy();
    expect(box('ממערב').value).toBe('5');
    expect(box('מצפון').value).toBe('5');
    expect(screen.getByRole('img', { name: 'מקור: נרשם ידנית' })).toBeTruthy();
    // The kind's size, in the one shared three-sided form (ruling P15).
    expect(screen.getByText('ברירת המחדל של אוהל: 3 × 3 × 2 מ׳')).toBeTruthy();
    expect(screen.queryByText('בנעילה')).toBeNull();
  });

  it('applies a size typed the way people type it, about the item’s middle', () => {
    const { after } = renderItem();
    type('רוחב', '2,5');
    expect(after().items[0]).toMatchObject({ widthCm: 250, depthCm: 200, xCm: 525, yCm: 500 });
  });

  it('refuses what is not a length, in Hebrew, and sends nothing', () => {
    const { onRun } = renderItem();
    const said: Record<string, string> = {
      abc: NOT_A_LENGTH,
      '1.234': NOT_A_LENGTH,
      0: 'צריך מספר בין 0.1 ל־500 מטר',
      '-1': 'צריך מספר בין 0.1 ל־500 מטר',
    };
    for (const [text, refusal] of Object.entries(said)) {
      type('רוחב', text);
      // `readMetres` isolates each number with U+2066…U+2069 so it keeps its place in RTL; read past them.
      const shown = (screen.getByRole('alert').textContent ?? '').replace(/[⁦-⁩]/g, '');
      expect(shown).toBe(refusal);
      expect(shown).toMatch(/[֐-׿]/);
      expect(shown).not.toMatch(/[A-Za-z]/);
      expect(box('רוחב').getAttribute('aria-invalid')).toBe('true');
    }
    expect(onRun).not.toHaveBeenCalled();
  });

  it('leaves a box that was emptied as it was', () => {
    const { onRun } = renderItem();
    type('רוחב', '');
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renames and moves on Enter, and refuses a blank name', () => {
    const { after, onRun } = renderItem();
    fireEvent.change(box('שם'), { target: { value: '  אוהל הצוות ' } });
    type('ממערב', '12,5');
    expect(after().items[0]).toMatchObject({ label: 'אוהל הצוות', xCm: 1250 });
    onRun.mockClear();
    type('שם', '   ');
    expect(screen.getByRole('alert').textContent).toBe(LABEL_REQUIRED);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('keeps a locked item where it is: its size and place cannot be typed, its name can', () => {
    renderItem({ locked: true });
    for (const name of ['רוחב', 'עומק', 'גובה', 'ממערב', 'מצפון']) expect(box(name).disabled).toBe(true);
    expect(box('שם').disabled).toBe(false);
    expect(screen.getByText(LOCKED_NOTICE)).toBeTruthy();
    // Ruling P11: a noun phrase, never an adjective that must agree with the item's name.
    expect(screen.getByText('בנעילה')).toBeTruthy();
  });

  it('names what it overlaps, and the name selects both', () => {
    const { onPickIds } = renderItem({}, [item({ id: 'b', label: 'אוהל 2', xCm: 600, yCm: 550 })]);
    fireEvent.click(screen.getByRole('button', { name: 'חפיפה עם אוהל 2' }));
    expect(onPickIds).toHaveBeenCalledWith(['a', 'b']);
  });

  it('keeps these sizes as the kind’s default, and goes back to the default', () => {
    const { after } = renderItem();
    fireEvent.click(screen.getByRole('button', { name: 'שמירת המידות כברירת המחדל של אוהל' }));
    expect(after().defaults.tent).toEqual({ widthCm: 300, depthCm: 200, heightCm: 200, insetCm: null });
    fireEvent.click(screen.getByRole('button', { name: 'חזרה לברירת המחדל' }));
    expect(after().items[0]).toMatchObject({ widthCm: 300, depthCm: 300, heightCm: null });
  });

  /* Ruling P13: the kind's own height, typed, is the kind's height — not a copy of it. */
  it('leaves the height its kind’s when the kind’s height is typed', () => {
    const { onRun } = renderItem();
    type('גובה', '2');
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('גובה ברירת מחדל')).toBeTruthy();
  });

  it('gives it a height of its own when another is typed', () => {
    const { after } = renderItem();
    type('גובה', '2,5');
    expect(after().items[0].heightCm).toBe(250);
  });

  it('shows the build task the item is linked to', () => {
    renderItem({ taskId: 't1' });
    const task = screen.getByLabelText('משימת הקמה') as HTMLSelectElement;
    expect(task.value).toBe('t1');
    expect(task.options[task.selectedIndex].text).toBe('הקמת הצל');
  });

  /* Fix round 1: a link the list does not hold is still a link — never "ללא משימת הקמה". */
  it('never says an item has no build task when it is linked to one the list does not hold', () => {
    renderItem({ taskId: 'elsewhere' });
    const task = screen.getByLabelText('משימת הקמה') as HTMLSelectElement;
    expect(task.value).toBe('elsewhere');
    expect(task.options[task.selectedIndex].text).toBe('משימה שאינה ברשימה');
  });

  it('links a build task through the store', () => {
    const { after } = renderItem();
    fireEvent.change(screen.getByLabelText('משימת הקמה'), { target: { value: 't1' } });
    expect(after().items[0].taskId).toBe('t1');
  });

  it('unlinks a build task through the store', () => {
    const { after } = renderItem({ taskId: 't1' });
    fireEvent.change(screen.getByLabelText('משימת הקמה'), { target: { value: '' } });
    expect(after().items[0].taskId).toBeNull();
  });

  it('keeps a locked net’s unshaded strip from being typed', () => {
    renderItem({ kind: 'shade', label: 'רשת צל 1', widthCm: 800, depthCm: 800, insetCm: 50, locked: true });
    expect(box('שוליים בלי צל').disabled).toBe(true);
  });

  it('lets a locked item’s notes and build task still be changed', () => {
    const { after, onRun } = renderItem({ locked: true });
    const notes = screen.getByLabelText('הערות') as HTMLTextAreaElement;
    const task = screen.getByLabelText('משימת הקמה') as HTMLSelectElement;
    expect(notes.disabled).toBe(false);
    expect(task.disabled).toBe(false);
    fireEvent.change(notes, { target: { value: 'הפתח לכיוון הרחוב' } });
    fireEvent.blur(notes);
    expect(after().items[0]).toMatchObject({ notes: 'הפתח לכיוון הרחוב', locked: true });
    fireEvent.change(task, { target: { value: 't1' } });
    expect(after().items[0]).toMatchObject({ taskId: 't1', locked: true });
    expect(onRun).toHaveBeenCalledTimes(2);
  });

  it('puts a height of its own back on its kind’s when the kind’s height is typed', () => {
    const { after } = renderItem({ heightCm: 250 });
    expect(box('גובה').value).toBe('2.5');
    expect(screen.queryByText('גובה ברירת מחדל')).toBeNull();
    type('גובה', '2');
    expect(after().items[0].heightCm).toBeNull();
  });
});
