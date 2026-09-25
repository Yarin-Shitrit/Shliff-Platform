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
const F = '3e2c9d1b-4f50-4172-9d2e-3f4a5b6c7d8e';

/** Matches the store's own bidi isolate around a name dropped into a notice (A17). */
const LRI = '⁦';
const PDI = '⁩';
const isolate = (name: string) => `${LRI}${name}${PDI}`;
const goneNotice = (...names: string[]) => `לא נשמרו שינויים בפריטים שכבר לא במפה: ${names.map(isolate).join(', ')}.`;
const lockedNotice = (...names: string[]) => `לא נשמרו שינויים בפריטים נעולים: ${names.map(isolate).join(', ')}.`;
const LOAD_FAILED = 'לא הצלחנו לטעון את המפה העדכנית. אפשר לנסות שוב.';
const PARTLY_APPLIED = 'חלק מהפעולה לא בוצע, כי פריטים שהיא נוגעת בהם כבר לא במפה.';

function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 100, yCm: 100, widthCm: 300, depthCm: 300,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

function doc(items: EditorItem[]): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, lines: [], defaults: {} };
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

  // Ruling 6, fix round 1 (probe P1): an op that reduces to nothing (every
  // field already matches the item) is dropped like a missing item — not
  // recorded, not sent — but is not a *skip* either: it is not a failure.
  it('records nothing and sends nothing for a run whose update leaves every field unchanged', async () => {
    const { result, save } = setup();
    act(() => { result.current.run('הזזה', [moveTo(A, 100)]); }); // A is already at xCm 100
    expect(result.current.canUndo).toBe(false);
    await waitForSave();
    expect(save).not.toHaveBeenCalled();
  });

  it('records nothing and sends nothing for an edit that changes nothing', async () => {
    const { result, save } = setup();
    act(() => { result.current.run('הזזה', [moveTo('nobody', 5)]); });
    expect(result.current.canUndo).toBe(false);
    await waitForSave();
    expect(save).not.toHaveBeenCalled();
  });

  // Fix round 1, finding 1 (probe P3's `run` half): a locked item is never
  // removed by `run` either — the op is skipped exactly like a locked update.
  it('never removes a locked item — the op is skipped like any other lock refusal', async () => {
    const { result, save } = setup({
      doc: doc([item({ id: A, label: 'אוהל 1', locked: true }), item({ id: B, label: 'אוהל 2', xCm: 600 })]),
    });
    act(() => { result.current.run('הסרה', [{ type: 'remove', id: A }]); });
    expect(result.current.doc.items.map((entry) => entry.id)).toEqual([A, B]);
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
      // Ruling (fix round 1, overrides the plan's original test): 'theirs'
      // clears undo/redo — every inverse was computed against a document
      // that no longer exists.
      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(false);

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
      const fresh = item({ id: F, label: 'אוהל 3', xCm: 2000 });
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
      expect(result.current.notice).toBe(goneNotice('אוהל 2'));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(result.current.save).toEqual({ status: 'saved', version: 6, pending: 0, error: null, errorKind: null });

      act(() => { result.current.dismissNotice(); });
      expect(result.current.notice).toBeNull();
    });

    // Fix round 1 (overrides the original brief test, which undid this move
    // after 'theirs' and expected it to still work — 'theirs' now clears
    // history, so there is nothing left to undo).
    it('clears undo/redo when the map is replaced by theirs', async () => {
      const save = conflicting();
      const theirs = doc([item({ id: A, label: 'אוהל 1' })]);
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
      const { result } = setup({ save, load });
      act(() => { result.current.run('הזזה', [moveTo(B, 900)]); });
      await waitForSave();
      expect(result.current.canUndo).toBe(true);

      await act(async () => { await result.current.resolveConflict('theirs'); });

      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(false);
      act(() => { expect(result.current.undo()).toBeNull(); });
      expect(result.current.doc).toEqual(theirs);
    });

    // Controller ruling S1 + fix round 1 finding 4: resolveConflict('mine')
    // drops an op a lock would refuse, and names it in its own sentence —
    // never the "no longer on the map" one.
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
      expect(result.current.notice).toBe(lockedNotice('אוהל 1'));
    });

    // Fix round 1, finding 1 (probe P3): 'mine' treats a remove a lock would
    // refuse exactly like a locked update — dropped, and named.
    it('names a locked item when "mine" would have removed it', async () => {
      const save = conflicting();
      const theirs = doc([item({ id: A, label: 'אוהל 1', locked: true })]);
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
      const { result } = setup({ save, load });
      act(() => { result.current.run('הסרה', [{ type: 'remove', id: A }]); });
      await waitForSave();
      expect(result.current.conflict).toEqual({ version: 5 });

      await act(async () => { await result.current.resolveConflict('mine'); });

      expect(result.current.doc.items.map((entry) => entry.id)).toEqual([A]);
      expect(result.current.notice).toBe(lockedNotice('אוהל 1'));
    });

    // Fix round 1, finding 4: both kinds of drop in the same pass — each
    // gets its own sentence, not folded into the other's.
    it('names locked items and missing items separately, when both happen in one pass', async () => {
      const save = conflicting();
      const theirs = doc([item({ id: A, label: 'אוהל 1', xCm: 700, locked: true })]); // B is gone entirely
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
      const { result } = setup({ save, load });
      act(() => { result.current.run('הזזה', [moveTo(A, 400), moveTo(B, 900)]); });
      await waitForSave();
      expect(result.current.conflict).toEqual({ version: 5 });

      await act(async () => { await result.current.resolveConflict('mine'); });

      expect(result.current.notice).toBe(`${goneNotice('אוהל 2')} ${lockedNotice('אוהל 1')}`);
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

    // Controller ruling S2, tightened by fix round 1 finding 2 (ruling 6):
    // the converted update carries only the fields that actually differ.
    it('turns an add into an update when the server already has that id, keeping only what differs', async () => {
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
      // Only label and xCm differ from what the server already has — kind,
      // widthCm and depthCm are identical and must not be resent.
      expect(save.mock.calls[1][1]).toEqual([{ type: 'update', id: C, patch: { label: 'קראוון חדש', xCm: 1800 } }]);
    });

    // Fix round 1, finding 2 (ruling 6, probe P4): the add had already
    // landed on the server and only the reply was lost to the conflict —
    // once reduced there is nothing left to send, and nothing to name.
    it('sends nothing when a pending add already matches what the server has', async () => {
      const save = conflicting();
      const fresh = item({ id: F, label: 'אוהל 3', xCm: 2000 });
      const theirs = doc([item({ id: A }), item({ id: B, label: 'אוהל 2', xCm: 600 }), fresh]);
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
      const { result } = setup({ save, load });
      act(() => { result.current.run('הוספה', [{ type: 'add', item: fresh }]); });
      await waitForSave();
      expect(result.current.conflict).toEqual({ version: 5 });

      await act(async () => { await result.current.resolveConflict('mine'); });

      expect(result.current.doc.items.find((entry) => entry.id === F)).toEqual(fresh);
      expect(result.current.notice).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(save).toHaveBeenCalledTimes(1); // the original conflicting send only
    });

    // Adapted from the reviewer's probe P7: update-then-remove of the same
    // item, both applied locally, and the item is also gone on the server —
    // the missing-item name falls back to "פריט", never the raw id, because
    // even this lead's own current doc has already forgotten it.
    it('falls back to a generic name when even this lead has forgotten the item', async () => {
      const save = conflicting();
      const theirs = doc([item({ id: A, label: 'אוהל 1' })]); // B is gone on the server too
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
      const { result } = setup({ save, load });
      act(() => {
        result.current.run('הזזה', [moveTo(B, 900)]);
        result.current.run('הסרה', [{ type: 'remove', id: B }]);
      });
      await waitForSave();
      expect(result.current.conflict).toEqual({ version: 5 });

      await act(async () => { await result.current.resolveConflict('mine'); });

      expect(result.current.notice).toBe(goneNotice('פריט'));
    });

    // Fix round 1, finding 2 (ruling 6): step()'s ops go through the same
    // reduction as run()'s — a redo that is already reflected in the doc
    // (another lead's server state happened to match) sends nothing.
    it('redoes nothing when the step is already reflected in the doc', async () => {
      const save = conflicting();
      const theirs = doc([item({ id: A, label: 'אוהל 1', xCm: 400, locked: true }), item({ id: B, label: 'אוהל 2', xCm: 600 })]);
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
      const { result, save: saveFn } = setup({ save, load });
      act(() => {
        result.current.run('הזזה', [moveTo(A, 400)]);
        result.current.undo();
      });
      await waitForSave();
      expect(result.current.conflict).toEqual({ version: 5 });

      await act(async () => { await result.current.resolveConflict('mine'); });
      expect(result.current.doc.items.find((entry) => entry.id === A)?.xCm).toBe(400);
      expect(result.current.canRedo).toBe(true);
      // The pending update (back to 100) really did differ from the server's
      // 400 — a genuine lock refusal, not a no-op — so it is named here.
      expect(result.current.notice).toBe(lockedNotice('אוהל 1'));

      act(() => { expect(result.current.redo()).toBe('הזזה'); });
      expect(result.current.canRedo).toBe(false); // history still advances
      expect(result.current.doc.items.find((entry) => entry.id === A)?.xCm).toBe(400);
      // The redo itself found nothing left to do (already 400) and is not a
      // skip, so it does not touch the notice left by 'mine'.
      expect(result.current.notice).toBe(lockedNotice('אוהל 1'));

      await waitForSave();
      expect(saveFn).toHaveBeenCalledTimes(1); // only the original conflicting send
    });

    // Fix round 2 (ruling 6, still not applied to the 'mine' loop's plain
    // `update` branch): a pending update whose patch already matches the
    // server's current value must be reduced through `changedUpdate` before
    // anything else, exactly like `applyEach` already does — otherwise it is
    // sent again even though nothing needs to change.
    it('drops a pending update that already matches the server, on an unlocked item', async () => {
      const save = conflicting();
      const theirs = doc([item({ id: A, label: 'אוהל 1', xCm: 400 }), item({ id: B, label: 'אוהל 2', xCm: 600 })]);
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
      const { result, save: saveFn } = setup({ save, load });
      act(() => { result.current.run('הזזה', [moveTo(A, 400)]); }); // A starts at 100 locally
      await waitForSave();
      expect(result.current.conflict).toEqual({ version: 5 });

      await act(async () => { await result.current.resolveConflict('mine'); });

      expect(result.current.doc.items.find((entry) => entry.id === A)?.xCm).toBe(400);
      expect(result.current.notice).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(saveFn).toHaveBeenCalledTimes(1); // only the original conflicting send — not resent
    });

    // Fix round 2: the same no-op, but on a locked item — `lockRefusal`
    // refuses on field presence, not value, so an un-reduced patch would be
    // reported as a lock refusal even though nothing needed to change.
    it('drops a pending update that already matches the server, on a locked item, without a notice', async () => {
      const save = conflicting();
      const theirs = doc([item({ id: A, label: 'אוהל 1', xCm: 400, locked: true }), item({ id: B, label: 'אוהל 2', xCm: 600 })]);
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
      const { result, save: saveFn } = setup({ save, load });
      act(() => { result.current.run('הזזה', [moveTo(A, 400)]); }); // A starts at 100 locally
      await waitForSave();
      expect(result.current.conflict).toEqual({ version: 5 });

      await act(async () => { await result.current.resolveConflict('mine'); });

      expect(result.current.doc.items.find((entry) => entry.id === A)?.xCm).toBe(400);
      expect(result.current.notice).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(saveFn).toHaveBeenCalledTimes(1);
    });

    // Fix round 1, findings 1 and 2 together, plus the minor finding: a
    // locked item's *real* (non-reduced-away) change is skipped by redo like
    // any other lock refusal, named generically (PARTLY_APPLIED, since an
    // undo/redo step can touch several items at once), and sends nothing.
    it('redo skips an item the other lead locked in the meantime, and sends nothing', async () => {
      const save = conflicting();
      const theirs = doc([item({ id: A, label: 'אוהל 1', xCm: 700, locked: true }), item({ id: B, label: 'אוהל 2', xCm: 600 })]);
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
      const { result, save: saveFn } = setup({ save, load });
      act(() => {
        result.current.run('הזזה', [moveTo(A, 400)]);
        result.current.undo();
      });
      await waitForSave();
      expect(result.current.conflict).toEqual({ version: 5 });

      await act(async () => { await result.current.resolveConflict('mine'); });
      expect(result.current.canRedo).toBe(true);

      act(() => { expect(result.current.redo()).toBe('הזזה'); });
      expect(result.current.doc.items.find((entry) => entry.id === A)?.xCm).toBe(700);
      expect(result.current.notice).toBe(PARTLY_APPLIED);

      await waitForSave();
      expect(saveFn).toHaveBeenCalledTimes(1); // only the original conflicting send — nothing sent by the redo
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

    // Fix round 1, finding 3: a load() that throws (offline) must not become
    // an unhandled rejection, and the conflict stays open so the lead can
    // try again.
    it('shows a Hebrew notice when the reload itself throws, and keeps the conflict open', async () => {
      const save = conflicting();
      const load = vi.fn<EditorStoreInit['load']>(async () => { throw new TypeError('Failed to fetch'); });
      const { result } = setup({ save, load });
      act(() => { result.current.run('הזזה', [moveTo(A, 400)]); });
      await waitForSave();
      expect(result.current.conflict).toEqual({ version: 5 });

      // Must resolve, not reject — an unhandled rejection would fail the test run.
      await act(async () => { await result.current.resolveConflict('theirs'); });

      expect(result.current.notice).toBe(LOAD_FAILED);
      expect(result.current.conflict).toEqual({ version: 5 });
    });

    // Fix round 1, finding 3: a second call while the first is still
    // awaiting load() does nothing — no second load(), no clobbered result.
    it('ignores a second resolveConflict call while the first is still running', async () => {
      const save = conflicting();
      const theirs = doc([item({ id: A, label: 'אוהל 1', xCm: 1500 })]);
      let releaseLoad: (() => void) | null = null;
      const load = vi.fn<EditorStoreInit['load']>(() => new Promise((resolve) => {
        releaseLoad = () => resolve({ ok: true, value: { doc: theirs, version: 5 } });
      }));
      const { result } = setup({ save, load });
      act(() => { result.current.run('הזזה', [moveTo(A, 400)]); });
      await waitForSave();

      let p1: Promise<void> = Promise.resolve();
      let p2: Promise<void> = Promise.resolve();
      act(() => {
        p1 = result.current.resolveConflict('theirs');
        p2 = result.current.resolveConflict('theirs');
      });
      expect(load).toHaveBeenCalledTimes(1);

      await act(async () => {
        releaseLoad?.();
        await p1;
        await p2;
      });
      expect(result.current.doc).toEqual(theirs);
      expect(result.current.conflict).toBeNull();
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
