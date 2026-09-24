/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import type { SaveResult, SiteOp } from '@/lib/site/editor/ops';
import { useEditorStore, type EditorStoreInit } from './use-editor-store';

const A = '0b9f6a8e-1c2d-4e3f-8a9b-0c1d2e3f4a5b';
const B = '1c0a7b9f-2d3e-4f50-9b0c-1d2e3f4a5b6c';
const C = '2d1b8c0a-3e4f-4061-8c1d-2e3f4a5b6c7d';

function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 100, yCm: 100, widthCm: 300, depthCm: 300,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

function doc(items: EditorItem[]): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, defaults: {} };
}

const moveTo = (id: string, xCm: number): SiteOp => ({ type: 'update', id, patch: { xCm } });

/** Advances the fake clock past the queue's half second, inside act. */
async function waitForSave() {
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
}

function setup(over: Partial<EditorStoreInit> = {}) {
  const save = vi.fn<EditorStoreInit['save']>(async (base) => ({ ok: true, version: base + 1 }));
  const load = vi.fn<EditorStoreInit['load']>();
  const init: EditorStoreInit = {
    doc: doc([item({ id: A, label: 'אוהל 1' }), item({ id: B, label: 'אוהל 2', xCm: 600 })]),
    version: 0, save, load, ...over,
  };
  const hook = renderHook(() => useEditorStore(init));
  return { ...hook, save: (over.save ?? save) as typeof save, load: (over.load ?? load) as typeof load };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the editor store', () => {
  it('shows an edit at once and saves it in the background', async () => {
    const { result, save } = setup();

    act(() => { result.current.run('הזזה', [moveTo(A, 400)], [A]); });

    expect(result.current.doc.items[0].xCm).toBe(400);
    expect(result.current.selection).toEqual([A]);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.save.status).toBe('pending');
    expect(save).not.toHaveBeenCalled();

    await waitForSave();
    expect(save).toHaveBeenCalledWith(0, [moveTo(A, 400)]);
    expect(result.current.save).toEqual({ status: 'saved', version: 1, pending: 0, error: null, errorKind: null });
  });

  it('undoes and redoes, naming the step, and saves each like any edit', async () => {
    const { result, save } = setup();
    act(() => { result.current.run('הזזה', [moveTo(A, 400)]); });

    let label: string | null = null;
    act(() => { label = result.current.undo(); });
    expect(label).toBe('הזזה');
    expect(result.current.doc.items[0].xCm).toBe(100);
    expect(result.current.canRedo).toBe(true);

    act(() => { label = result.current.redo(); });
    expect(label).toBe('הזזה');
    expect(result.current.doc.items[0].xCm).toBe(400);

    await waitForSave();
    // Three edits inside the half second go out as one coalesced batch.
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(0, [moveTo(A, 400)]);
    act(() => { expect(result.current.redo()).toBeNull(); });
  });

  it('flags what is outside the fence, what overlaps and what is half under a net', () => {
    const { result } = setup({
      doc: doc([
        item({ id: A, xCm: 2500 }),
        item({ id: B, xCm: 1000, yCm: 1000 }),
        item({ id: C, xCm: 1100, yCm: 1100, kind: 'sofa', widthCm: 200, depthCm: 90 }),
        item({ id: 'net', kind: 'shade', label: 'רשת צל 1', xCm: 0, yCm: 1100, widthCm: 1150, depthCm: 800, insetCm: 50 }),
      ]),
    });
    const { flags } = result.current;
    expect([...flags.outside]).toEqual([A]);
    expect([...flags.overlapping].sort()).toEqual([B, C].sort());
    expect(flags.pairs).toEqual([[B, C]]);
    expect(flags.partly.has(C)).toBe(true);
  });

  it('selects only what exists, and forgets an item once it is removed', () => {
    const { result } = setup();
    act(() => { result.current.select([A, 'nobody', A]); });
    expect(result.current.selection).toEqual([A]);
    act(() => { result.current.run('הסרה', [{ type: 'remove', id: A }]); });
    expect(result.current.selection).toEqual([]);
  });

  it('records nothing and sends nothing for an edit that changes nothing', async () => {
    const { result, save } = setup();
    act(() => { result.current.run('הזזה', [moveTo('nobody', 5)]); });
    expect(result.current.canUndo).toBe(false);
    await waitForSave();
    expect(save).not.toHaveBeenCalled();
  });

  it('says in Hebrew why the server refused, and retries on request', async () => {
    const save = vi.fn<EditorStoreInit['save']>()
      .mockResolvedValueOnce({ ok: false, reason: 'refused', error: 'הפריט נעול. אפשר לשחרר את הנעילה ואז לשנות אותו' })
      .mockResolvedValueOnce({ ok: true, version: 1 });
    const { result } = setup({ save });
    act(() => { result.current.run('הזזה', [moveTo(A, 400)]); });
    await waitForSave();

    expect(result.current.save).toMatchObject({ status: 'error', error: 'הפריט נעול. אפשר לשחרר את הנעילה ואז לשנות אותו' });
    await act(async () => { result.current.retrySave(); await vi.advanceTimersByTimeAsync(0); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.save.status).toBe('saved');
  });

  describe('when another lead saved first', () => {
    const conflicting = () => vi.fn<EditorStoreInit['save']>(async (base): Promise<SaveResult> => (
      base === 0 ? { ok: false, reason: 'conflict', version: 5 } : { ok: true, version: base + 1 }
    ));

    it('shows the conflict and sends nothing more', async () => {
      const save = conflicting();
      const { result } = setup({ save });
      act(() => { result.current.run('הזזה', [moveTo(A, 400)]); });
      await waitForSave();
      expect(result.current.conflict).toEqual({ version: 5 });

      act(() => { result.current.run('הזזה', [moveTo(B, 900)]); });
      await waitForSave();
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('takes their map and drops the unsent changes', async () => {
      const save = conflicting();
      const theirs = doc([item({ id: A, label: 'אוהל 1', xCm: 1500 })]);
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
      const { result } = setup({ save, load });
      act(() => { result.current.run('הזזה', [moveTo(A, 400)], [B]); });
      await waitForSave();

      await act(async () => { await result.current.resolveConflict('theirs'); });

      expect(load).toHaveBeenCalledTimes(1);
      expect(result.current.doc).toEqual(theirs);
      expect(result.current.conflict).toBeNull();
      expect(result.current.selection).toEqual([]);
      expect(result.current.save).toEqual({ status: 'saved', version: 5, pending: 0, error: null, errorKind: null });

      act(() => { result.current.run('הזזה', [moveTo(A, 1600)]); });
      await waitForSave();
      expect(save).toHaveBeenLastCalledWith(5, [moveTo(A, 1600)]);
    });

    it('keeps my changes on top of theirs, and names the items they removed', async () => {
      const save = conflicting();
      // The other lead removed אוהל 2 and added a caravan.
      const theirs = doc([
        item({ id: A, label: 'אוהל 1', yCm: 700 }),
        item({ id: C, kind: 'caravan', label: 'קראוון 1', xCm: 1500, widthCm: 700, depthCm: 250 }),
      ]);
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
      const fresh = item({ id: '3e2c9d1b-4f50-4172-9d2e-3f4a5b6c7d8e', label: 'אוהל 3', xCm: 2000 });
      const { result } = setup({ save, load });
      act(() => {
        result.current.run('הזזה', [moveTo(A, 400), moveTo(B, 900)]);
        result.current.run('הוספה', [{ type: 'add', item: fresh }]);
      });
      await waitForSave();
      expect(result.current.conflict).toEqual({ version: 5 });

      await act(async () => { await result.current.resolveConflict('mine'); });

      expect(save).toHaveBeenLastCalledWith(5, [moveTo(A, 400), { type: 'add', item: fresh }]);
      expect(result.current.doc.items.map((entry) => [entry.id, entry.xCm, entry.yCm])).toEqual([
        [A, 400, 700], [C, 1500, 100], [fresh.id, 2000, 100],
      ]);
      expect(result.current.notice).toBe('לא נשמרו שינויים בפריטים שכבר לא במפה: אוהל 2.');
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(result.current.save).toEqual({ status: 'saved', version: 6, pending: 0, error: null, errorKind: null });

      act(() => { result.current.dismissNotice(); });
      expect(result.current.notice).toBeNull();
    });

    it('undoes an edit to an item the other lead removed without breaking, and says so', async () => {
      const save = conflicting();
      const theirs = doc([item({ id: A, label: 'אוהל 1' })]);
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
      const { result } = setup({ save, load });
      act(() => { result.current.run('הזזה', [moveTo(B, 900)]); });
      await waitForSave();
      await act(async () => { await result.current.resolveConflict('theirs'); });

      act(() => { expect(result.current.undo()).toBe('הזזה'); });
      expect(result.current.doc).toEqual(theirs);
      expect(result.current.notice).toBe('חלק מהפעולה לא בוצע, כי פריטים שהיא נוגעת בהם כבר לא במפה.');
    });

    // Controller ruling S1: an op `lockRefusal` would refuse against the
    // current doc is skipped like a missing item — an undo included.
    it('undoes an edit to an item the other lead locked without breaking, and says so', async () => {
      const save = conflicting();
      const theirs = doc([item({ id: A, label: 'אוהל 1', xCm: 700, locked: true })]);
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
      const { result } = setup({ save, load });
      act(() => { result.current.run('הזזה', [moveTo(A, 400)]); });
      await waitForSave();
      await act(async () => { await result.current.resolveConflict('theirs'); });

      act(() => { expect(result.current.undo()).toBe('הזזה'); });
      // The undo would have set xCm back to 100 — it must not have, since A is locked.
      expect(result.current.doc.items[0].xCm).toBe(700);
      expect(result.current.notice).toBe('חלק מהפעולה לא בוצע, כי פריטים שהיא נוגעת בהם כבר לא במפה.');
    });

    // Controller ruling S1: resolveConflict('mine') drops and names ops a
    // lock would refuse, the same way it names a missing item.
    it('names an item the other lead locked, when keeping mine on top of it', async () => {
      const save = conflicting();
      const theirs = doc([item({ id: A, label: 'אוהל 1', xCm: 700, locked: true })]);
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
      const { result } = setup({ save, load });
      act(() => { result.current.run('הזזה', [moveTo(A, 400)]); });
      await waitForSave();
      expect(result.current.conflict).toEqual({ version: 5 });

      await act(async () => { await result.current.resolveConflict('mine'); });

      expect(result.current.doc.items[0].xCm).toBe(700);
      expect(result.current.notice).toBe('לא נשמרו שינויים בפריטים שכבר לא במפה: אוהל 1.');
    });

    // Controller ruling S2: a remove of an item already gone on the server
    // is dropped silently — it does the same thing either way.
    it('drops a removal of an item already gone on the server without naming it', async () => {
      const save = conflicting();
      const theirs = doc([item({ id: B, label: 'אוהל 2', xCm: 600 })]);
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
      const { result } = setup({ save, load });
      act(() => { result.current.run('הסרה', [{ type: 'remove', id: A }]); });
      await waitForSave();
      expect(result.current.conflict).toEqual({ version: 5 });

      await act(async () => { await result.current.resolveConflict('mine'); });

      expect(result.current.doc).toEqual(theirs);
      expect(result.current.notice).toBeNull();
    });

    // Controller ruling S2: an add whose id the server already has becomes
    // an update of that item, rather than being dropped.
    it('turns an add into an update when the server already has that id', async () => {
      const save = conflicting();
      const theirs = doc([
        item({ id: A, label: 'אוהל 1' }),
        item({ id: C, kind: 'caravan', label: 'קראוון ישן', xCm: 1500, widthCm: 700, depthCm: 250 }),
      ]);
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
      const { result } = setup({ save, load });
      act(() => {
        result.current.run('הוספה', [{
          type: 'add',
          item: item({ id: C, kind: 'caravan', label: 'קראוון חדש', xCm: 1800, widthCm: 700, depthCm: 250 }),
        }]);
      });
      await waitForSave();
      expect(result.current.conflict).toEqual({ version: 5 });

      await act(async () => { await result.current.resolveConflict('mine'); });

      const merged = result.current.doc.items.find((entry) => entry.id === C);
      expect(merged?.label).toBe('קראוון חדש');
      expect(merged?.xCm).toBe(1800);
      expect(result.current.notice).toBeNull();

      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(save).toHaveBeenCalledTimes(2);
      expect(save.mock.calls[1][1]).toEqual([{ type: 'update', id: C, patch: expect.objectContaining({ label: 'קראוון חדש', xCm: 1800 }) }]);
    });

    it('reports a failed reload in Hebrew and stays in the conflict', async () => {
      const save = conflicting();
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: false, error: 'אין הרשאה' }));
      const { result } = setup({ save, load });
      act(() => { result.current.run('הזזה', [moveTo(A, 400)]); });
      await waitForSave();
      await act(async () => { await result.current.resolveConflict('mine'); });
      expect(result.current.notice).toBe('אין הרשאה');
      expect(result.current.conflict).toEqual({ version: 5 });
    });
  });

  it('warns before the tab closes while a change is unsent', async () => {
    const { result } = setup();
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);
    act(() => { result.current.run('הזזה', [moveTo(A, 400)]); });
    expect(leave()).toBe(true);
    await waitForSave();
    expect(leave()).toBe(false);
  });

  it('sends at once when the tab is hidden or the page goes away', async () => {
    const { result, save } = setup();
    act(() => { result.current.run('הזזה', [moveTo(A, 400)]); });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(save).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

    act(() => { result.current.run('הזזה', [moveTo(B, 900)]); });
    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(1, [moveTo(B, 900)]);
  });
});
