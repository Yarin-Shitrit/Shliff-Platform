/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { EditorDoc, EditorItem, EditorLine } from '@/lib/site/editor/model';
import { applyOps, type SiteOp } from '@/lib/site/editor/ops';
import { LINE_LABEL_REQUIRED } from '../../failure-messages';
import { LineInspector, LinesInspector, midpointOfLongestLeg } from './inspector-line';

/* This file's own fixture: a tank at the origin, a shower five metres east, a sink south of the shower, a toilet. */
function item(over: Partial<EditorItem> & { id: string; kind: EditorItem['kind']; label: string }): EditorItem {
  return {
    xCm: 0, yCm: 0, widthCm: 100, depthCm: 100, heightCm: null, insetCm: null, ropeAngleDeg: null,
    sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}
const TANK = item({ id: 'tank', kind: 'water', label: 'מי שתייה 1' });
const SHOWER = item({ id: 'shower', kind: 'shower', label: 'מקלחת 1', xCm: 500 });
const SINK = item({ id: 'sink', kind: 'sink', label: 'כיור 1', xCm: 500, yCm: 300, depthCm: 50 });
const TOILET = item({ id: 'toilet', kind: 'toilet', label: 'תא שירותים 1', xCm: 300, yCm: 300 });

function line(over: Partial<EditorLine> = {}): EditorLine {
  return { id: 'pipe', kind: 'water', label: 'צינור מים 1', fromId: 'tank', toId: 'shower', points: [], sort: 0, notes: null, ...over };
}

function doc(lines: EditorLine[]): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items: [TANK, SHOWER, SINK, TOILET], lines, defaults: {} };
}

function renderLine(over: Partial<EditorLine> = {}) {
  const shown = line(over);
  const map = doc([shown]);
  const onRun = vi.fn<(label: string, ops: SiteOp[]) => void>();
  const onPickIds = vi.fn();
  render(<LineInspector doc={map} line={shown} onRun={onRun} onPickIds={onPickIds} footer={<span>footer</span>} />);
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

describe('one line', () => {
  it('names it, says its kind and its length on the map, and that it was drawn by hand', () => {
    renderLine();
    expect(screen.getByRole('heading', { name: 'צינור מים 1' })).toBeTruthy();
    expect(screen.getByText('צינור מים')).toBeTruthy();
    // Tank east wall (100, 50) to shower west wall (500, 50).
    expect(screen.getByText('4 מ׳')).toBeTruthy();
    expect(screen.getByText(/נמדד מקיר לקיר/)).toBeTruthy();
    expect(screen.getByRole('img', { name: 'מקור: נרשם ידנית' })).toBeTruthy();
    expect(screen.getByText('footer')).toBeTruthy();
  });

  it('names both ends as buttons that select them', () => {
    const { onPickIds } = renderLine();
    fireEvent.click(screen.getByRole('button', { name: 'מקלחת 1' }));
    expect(onPickIds).toHaveBeenCalledWith(['shower']);
    fireEvent.click(screen.getByRole('button', { name: 'מי שתייה 1' }));
    expect(onPickIds).toHaveBeenCalledWith(['tank']);
  });

  it('moves an end only to an item the utility reaches — a toilet is not offered', () => {
    const { after } = renderLine();
    const to = screen.getByLabelText('אל') as HTMLSelectElement;
    // Every item water reaches but the other end — the tank — and never the toilet.
    expect([...to.options].map((option) => option.text)).toEqual(['מקלחת 1', 'כיור 1']);
    fireEvent.change(to, { target: { value: 'sink' } });
    expect(after().lines[0].toId).toBe('sink');
  });

  it('adds a bend at the middle of the longest leg, and the length follows', () => {
    const { after } = renderLine();
    expect(screen.getByText(/הקו ישר/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'הוספת נקודת פנייה' }));
    expect(after().lines[0].points).toEqual([[300, 50]]);
  });

  it('types a bend in metres and removes one', () => {
    const { after, onRun } = renderLine({ points: [[300, 50]] });
    expect(box('ממערב').value).toBe('3');
    expect(box('מצפון').value).toBe('0.5');
    type('מצפון', '3,5');
    expect(after().lines[0].points).toEqual([[300, 350]]);
    onRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'הסרת נקודת פנייה 1' }));
    expect(after().lines[0].points).toEqual([]);
  });

  it('refuses a bend that is not a length, in Hebrew, and sends nothing', () => {
    const { onRun } = renderLine({ points: [[300, 50]] });
    type('ממערב', 'abc');
    const shown = screen.getByRole('alert').textContent ?? '';
    expect(shown).toMatch(/[֐-׿]/);
    expect(shown).not.toMatch(/[A-Za-z]/);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('renames on Enter, keeps notes, and refuses a blank name', () => {
    const { after, onRun } = renderLine();
    type('שם', ' הצינור לכיור ');
    expect(after().lines[0].label).toBe('הצינור לכיור');
    const notes = screen.getByLabelText('הערות') as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: 'צינור 3/4' } });
    fireEvent.blur(notes);
    expect(after().lines[0].notes).toBe('צינור 3/4');
    onRun.mockClear();
    type('שם', '   ');
    expect(screen.getByRole('alert').textContent).toBe(LINE_LABEL_REQUIRED);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('says when an end is no longer on the map rather than printing a length', () => {
    renderLine({ toId: 'gone' });
    expect(screen.getByText('אחד הקצוות כבר לא במפה')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'הוספת נקודת פנייה' })).toHaveProperty('disabled', true);
  });
});

describe('the middle of the longest leg', () => {
  it('is on the longest leg, rounded to whole centimetres', () => {
    expect(midpointOfLongestLeg([[100, 50], [500, 50]])).toEqual([300, 50]);
    expect(midpointOfLongestLeg([[0, 0], [0, 100], [0, 701]])).toEqual([0, 401]);
    expect(midpointOfLongestLeg([[0, 0]])).toBeNull();
  });
});

describe('several lines', () => {
  it('lists each with its length, each a button to it', () => {
    const lines = [line(), line({ id: 'pipe2', label: 'צינור מים 2', fromId: 'shower', toId: 'sink' })];
    const onPickIds = vi.fn();
    render(<LinesInspector doc={doc(lines)} lines={lines} onPickIds={onPickIds} />);
    expect(screen.getByRole('heading', { name: '2 קווים' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'צינור מים 2 2 מ׳' }));
    expect(onPickIds).toHaveBeenCalledWith(['pipe2']);
  });
});
