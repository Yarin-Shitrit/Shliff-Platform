/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { EditorDoc, EditorItem, EditorLine } from '@/lib/site/editor/model';
import type { SaveResult, SiteOp } from '@/lib/site/editor/ops';
import { useEditorStore, type EditorStoreInit } from './use-editor-store';

/**
 * The store with pipes and cables in it (`site_lines`): a line can be
 * selected, removed and undone like an item, and a conflict resolved with
 * 'mine' drops — and names — a line whose end the other lead removed, rather
 * than sending a batch the server would refuse whole.
 */

const TANK = 'aaaaaaaa-0000-4000-8000-000000000001';
const SHOWER = 'aaaaaaaa-0000-4000-8000-000000000002';
const PIPE = 'bbbbbbbb-0000-4000-8000-000000000001';
const PIPE2 = 'bbbbbbbb-0000-4000-8000-000000000002';

const FSI = '\u2068'; // first-strong: a name keeps its own direction (#25 fix round)
const PDI = '⁩';
const isolate = (name: string) => `${FSI}${name}${PDI}`;

function item(over: Partial<EditorItem> & { id: string; kind: EditorItem['kind']; label: string }): EditorItem {
  return {
    xCm: 0, yCm: 0, widthCm: 100, depthCm: 100, heightCm: null, insetCm: null,
    sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}
const tank = item({ id: TANK, kind: 'water', label: 'מי שתייה 1' });
const shower = item({ id: SHOWER, kind: 'shower', label: 'מקלחת 1', xCm: 500 });
const pipe: EditorLine = { id: PIPE, kind: 'water', label: 'צינור מים 1', fromId: TANK, toId: SHOWER, points: [], sort: 0, notes: null };

function doc(items: EditorItem[], lines: EditorLine[]): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, lines, defaults: {} };
}

async function waitForSave() {
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
}

function setup(over: Partial<EditorStoreInit> = {}) {
  const save = vi.fn<EditorStoreInit['save']>(async (base) => ({ ok: true, version: base + 1 }));
  const load = vi.fn<EditorStoreInit['load']>();
  const init: EditorStoreInit = { doc: doc([tank, shower], [pipe]), version: 0, save, load, ...over };
  const hook = renderHook(() => useEditorStore(init));
  return { ...hook, save: (over.save ?? save) as typeof save, load: (over.load ?? load) as typeof load };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('lines in the store', () => {
  it('keeps a line in the selection, and drops it when the line goes', () => {
    const { result } = setup({ selection: [PIPE, 'nope'] });
    expect(result.current.selection).toEqual([PIPE]);
    act(() => { result.current.run('הסרה', [{ type: 'removeLine', id: PIPE }]); });
    expect(result.current.doc.lines).toEqual([]);
    expect(result.current.selection).toEqual([]);
  });

  it('undoes a removed line, and saves the undo', async () => {
    const { result, save } = setup();
    act(() => { result.current.run('הסרה', [{ type: 'removeLine', id: PIPE }]); });
    act(() => { result.current.undo(); });
    expect(result.current.doc.lines).toEqual([pipe]);
    await waitForSave();
    // A remove and then the add that undoes it stay in that order, as an item's would: the server sees both.
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1].map((op) => op.type)).toEqual(['removeLine', 'addLine']);
  });

  it('drops an update that changes nothing about a line, bends included', () => {
    const { result } = setup();
    act(() => { result.current.run('עריכה', [{ type: 'updateLine', id: PIPE, patch: { points: [] } }]); });
    expect(result.current.canUndo).toBe(false);
  });

  it('"mine" drops and names a pending line whose end the other lead removed, and keeps the rest', async () => {
    const save = vi.fn<EditorStoreInit['save']>(async (base): Promise<SaveResult> => (
      base === 0 ? { ok: false, reason: 'conflict', version: 5 } : { ok: true, version: base + 1 }
    ));
    const { result, load } = setup({ save });
    const second: EditorLine = { ...pipe, id: PIPE2, label: 'צינור מים 2', fromId: SHOWER, toId: TANK, sort: 1 };
    act(() => {
      result.current.run('הוספה', [{ type: 'addLine', line: second }]);
      result.current.run('עריכה', [{ type: 'updateLine', id: PIPE, patch: { notes: 'לאורך הגדר' } }]);
    });
    await waitForSave();
    expect(result.current.conflict).toEqual({ version: 5 });

    // The server's map: the shower is gone, and with it the pipe (the cascade).
    load.mockResolvedValue({ ok: true, value: { doc: doc([tank], []), version: 5 } });
    await act(async () => { await result.current.resolveConflict('mine'); });

    expect(result.current.conflict).toBeNull();
    expect(result.current.doc.lines).toEqual([]);
    expect(result.current.notice).toBe(`לא נשמרו שינויים בפריטים שכבר לא במפה: ${[isolate('צינור מים 2'), isolate('צינור מים 1')].join(', ')}.`);
    const sent: SiteOp[][] = save.mock.calls.slice(1).map((call) => call[1]);
    expect(sent.flat()).toEqual([]);
  });
});
