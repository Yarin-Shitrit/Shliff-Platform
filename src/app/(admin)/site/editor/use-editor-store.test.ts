/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { EditorDoc, EditorItem, EditorLine } from '@/lib/site/editor/model';
import type { SaveResult, SiteOp } from '@/lib/site/editor/ops';
import { useEditorStore, type EditorStoreInit } from './use-editor-store';

const A = '0b9f6a8e-1c2d-4e3f-8a9b-0c1d2e3f4a5b';
const B = '1c0a7b9f-2d3e-4f50-9b0c-1d2e3f4a5b6c';
const C = '2d1b8c0a-3e4f-4061-8c1d-2e3f4a5b6c7d';
const F = '3e2c9d1b-4f50-4172-9d2e-3f4a5b6c7d8e';

/** Matches the store's own bidi isolate around a name dropped into a notice (A17). */
const FSI = '\u2068'; // first-strong: a name keeps its own direction (#25 fix round)
const PDI = '⁩';
const isolate = (name: string) => `${FSI}${name}${PDI}`;
const goneNotice = (...names: string[]) => `לא נשמרו שינויים בפריטים שכבר לא במפה: ${names.map(isolate).join(', ')}.`;
const lockedNotice = (...names: string[]) => `לא נשמרו שינויים בפריטים נעולים: ${names.map(isolate).join(', ')}.`;
const LOAD_FAILED = 'לא הצלחנו לטעון את המפה העדכנית. אפשר לנסות שוב.';
const PARTLY_APPLIED = 'חלק מהפעולה לא בוצע, כי פריטים שהיא נוגעת בהם כבר לא במפה.';

function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 100, yCm: 100, widthCm: 300, depthCm: 300,
    heightCm: null, insetCm: null, ropeAngleDeg: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
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

  /* Review minor: a marquee asks for the same selection on every pointer
     move; each ask committed a new state and re-rendered the whole editor. */
  it('does nothing when asked for the selection it already has', () => {
    let renders = 0;
    const init: EditorStoreInit = {
      doc: doc([item({ id: A }), item({ id: B, label: 'אוהל 2', xCm: 600 })]),
      version: 0,
      save: vi.fn<EditorStoreInit['save']>(async (base) => ({ ok: true, version: base + 1 })),
      load: vi.fn<EditorStoreInit['load']>(),
    };
    const { result } = renderHook(() => { renders += 1; return useEditorStore(init); });
    act(() => { result.current.select([A, B]); });
    const selection = result.current.selection;
    const before = renders;
    act(() => { result.current.select([A, B]); });
    act(() => { result.current.select([A, 'nobody', B]); }); // reads back as the same selection
    expect(renders).toBe(before);
    expect(result.current.selection).toBe(selection);
    act(() => { result.current.select([B, A]); }); // another order is another selection
    expect(result.current.selection).toEqual([B, A]);
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

  it('says whether a run recorded a step, so a caller never reports an edit that did not happen', () => {
    const { result } = setup({
      doc: doc([item({ id: A, label: 'אוהל 1', locked: true }), item({ id: B, label: 'אוהל 2', xCm: 600 })]),
    });
    let recorded: boolean | null = null;
    act(() => { recorded = result.current.run('הזזה', [moveTo(B, 900)]); });
    expect(recorded).toBe(true);
    act(() => { recorded = result.current.run('הסרה', [{ type: 'remove', id: A }]); }); // the lock holds
    expect(recorded).toBe(false);
    act(() => { recorded = result.current.run('הזזה', [moveTo('nobody', 5)]); });
    expect(recorded).toBe(false);
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

  /*
   * Review C2: another lead removed an item this lead has just moved. The
   * server skips the move and says so; the item leaves this map too, by the
   * name the lead knew it by — the same sentence 'mine' uses.
   */
  it('drops and names an item the server skipped because another lead removed it', async () => {
    const save = vi.fn<EditorStoreInit['save']>(async (base) => ({ ok: true, version: base + 1, skipped: [B] }));
    const { result } = setup({ save });
    act(() => { result.current.run('הזזה', [moveTo(A, 400), moveTo(B, 900)], [A, B]); });
    await waitForSave();
    expect(result.current.doc.items.map((entry) => entry.id)).toEqual([A]);
    expect(result.current.doc.items[0].xCm).toBe(400);
    expect(result.current.selection).toEqual([A]);
    expect(result.current.notice).toBe(goneNotice('אוהל 2'));
    expect(result.current.save).toMatchObject({ status: 'saved', version: 1, pending: 0 });
  });

  /* #25 fix round, Minor 9: on the server an item's lines go with it (the
     schema cascades). The store dropped the skipped item but kept its cable,
     drawn to nothing. */
  it('drops the lines of an item the server skipped because another lead removed it', async () => {
    const save = vi.fn<EditorStoreInit['save']>(async (base) => ({ ok: true, version: base + 1, skipped: [B] }));
    const cable: EditorLine = { id: 'cable', kind: 'power', label: 'כבל חשמל 1', fromId: A, toId: B, points: [], sort: 0, notes: null };
    const other: EditorLine = { id: 'pipe', kind: 'water', label: 'צינור מים 1', fromId: A, toId: C, points: [], sort: 1, notes: null };
    const { result } = setup({
      save,
      doc: {
        ...doc([
          item({ id: A, label: 'מקרר 1', kind: 'fridge' }),
          item({ id: B, label: 'גנרטור 1', kind: 'generator', xCm: 600 }),
          item({ id: C, label: 'כיור 1', kind: 'sink', xCm: 1200 }),
        ]),
        lines: [cable, other],
      },
    });
    act(() => { result.current.select([A, 'cable']); });
    act(() => { result.current.run('הזזה', [moveTo(B, 900)]); });
    await waitForSave();
    expect(result.current.doc.items.map((entry) => entry.id)).toEqual([A, C]);
    expect(result.current.doc.lines.map((line) => line.id)).toEqual(['pipe']);
    expect(result.current.selection).not.toContain('cable');
    expect(result.current.notice).toBe(goneNotice('גנרטור 1'));
  });

  it('says nothing about a skipped removal of an item already gone here too', async () => {
    const save = vi.fn<EditorStoreInit['save']>(async (base) => ({ ok: true, version: base + 1, skipped: [B] }));
    const { result } = setup({ save });
    act(() => { result.current.run('הסרה', [{ type: 'remove', id: B }]); });
    await waitForSave();
    expect(result.current.doc.items.map((entry) => entry.id)).toEqual([A]);
    expect(result.current.notice).toBeNull();
  });

  /*
   * #25 fix round, Important 2 and Minor 7: the edits an older build left
   * unsaved are replayed through 'mine'. They used to be enqueued first,
   * which started the half-second clock — a load slower than that sent them
   * raw, before 'mine' could check them, and a lock the other lead had set
   * came back as a false conflict. They now wait apart, sending nothing,
   * until 'mine' has the map; and once saved, the lead is told.
   */
  describe('replaying what an older build left unsaved', () => {
    const REPLAYED = 'השינויים שלא נשמרו לפני רענון הדף שוחזרו ונשמרו.';

    it('sends nothing until the map has loaded, however long that takes, then only what still applies', async () => {
      const save = vi.fn<EditorStoreInit['save']>(async (base) => ({ ok: true, version: base + 1 }));
      let answer: (value: Awaited<ReturnType<EditorStoreInit['load']>>) => void = () => {};
      const load = vi.fn<EditorStoreInit['load']>(() => new Promise((resolve) => { answer = resolve; }));
      const { result } = setup({ save, load, version: 3, pending: [moveTo(A, 550), moveTo(B, 900)] });
      expect(load).toHaveBeenCalledTimes(1);
      // An edit made while it loads must not carry the old batch out with it either.
      act(() => { result.current.run('הזזה', [moveTo(B, 950)]); });
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(save).not.toHaveBeenCalled();
      expect(result.current.save.status).toBe('pending');

      // Meanwhile the other lead locked the first tent: that move is dropped and named, the rest goes.
      await act(async () => {
        answer({ ok: true, value: { doc: doc([item({ id: A, label: 'אוהל 1', locked: true }), item({ id: B, label: 'אוהל 2', xCm: 600 })]), version: 4 } });
        await vi.advanceTimersByTimeAsync(0);
      });
      await waitForSave();
      expect(save).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledWith(4, [moveTo(B, 950)]);
      expect(result.current.conflict).toBeNull();
      expect(result.current.notice).toBe(`${REPLAYED} ${lockedNotice('אוהל 1')}`);
    });

    it('says, once they are saved, that the earlier edits were restored', async () => {
      let saved: (value: SaveResult) => void = () => {};
      const save = vi.fn<EditorStoreInit['save']>(() => new Promise((resolve) => { saved = resolve; }));
      const load = vi.fn<EditorStoreInit['load']>(async () => ({
        ok: true, value: { doc: doc([item({ id: A, label: 'אוהל 1' }), item({ id: B, label: 'אוהל 2', xCm: 600 })]), version: 3 },
      }));
      const { result } = setup({ save, load, version: 3, pending: [moveTo(A, 550)] });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(save).toHaveBeenCalledWith(3, [moveTo(A, 550)]);
      expect(result.current.notice).toBeNull(); // not while it is still being sent
      await act(async () => { saved({ ok: true, version: 4 }); await vi.advanceTimersByTimeAsync(0); });
      expect(result.current.notice).toBe(REPLAYED);
    });

    it('announces nothing when every earlier edit was dropped — what was dropped is named instead', async () => {
      const save = vi.fn<EditorStoreInit['save']>(async (base) => ({ ok: true, version: base + 1 }));
      const load = vi.fn<EditorStoreInit['load']>(async () => ({
        ok: true, value: { doc: doc([item({ id: A, label: 'אוהל 1', locked: true }), item({ id: B, label: 'אוהל 2', xCm: 600 })]), version: 3 },
      }));
      const { result } = setup({ save, load, version: 3, pending: [moveTo(A, 550)] });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await waitForSave();
      expect(save).not.toHaveBeenCalled();
      expect(result.current.notice).toBe(lockedNotice('אוהל 1'));
    });

    it('keeps the old batch as it was, so an add and its removal do not cancel out when the add had landed', async () => {
      const save = vi.fn<EditorStoreInit['save']>(async (base) => ({ ok: true, version: base + 1 }));
      const added = item({ id: F, label: 'אוהל 3', xCm: 2000 });
      // The add went out in a batch that got no answer — it did land — then the lead removed the tent.
      const load = vi.fn<EditorStoreInit['load']>(async () => ({
        ok: true, value: { doc: doc([item({ id: A }), item({ id: B, label: 'אוהל 2', xCm: 600 }), added]), version: 4 },
      }));
      const { result } = setup({ save, load, version: 3, pending: [{ type: 'add', item: added }, { type: 'remove', id: F }] });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await waitForSave();
      // Coalesced, the two would have come to nothing and the tent would stay on the server.
      expect(save).toHaveBeenCalledWith(4, [{ type: 'remove', id: F }]);
      expect(result.current.doc.items.map((entry) => entry.id)).not.toContain(F);
    });

    it('sends the old batch anyway if the map cannot be loaded, rather than holding it forever', async () => {
      const save = vi.fn<EditorStoreInit['save']>(async (base) => ({ ok: true, version: base + 1 }));
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: false, error: 'המפה לא נטענה' }));
      const { result } = setup({ save, load, version: 3, pending: [moveTo(A, 550)] });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await waitForSave();
      expect(save).toHaveBeenCalledWith(3, [moveTo(A, 550)]);
      expect(result.current.save.status).toBe('saved');
    });
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

    /*
     * Review I5: 'mine' kept history, but every entry's inverse was worked
     * out against a map that no longer exists. Here this lead moved A (saved),
     * then B; meanwhile the other lead moved A to 700. After 'mine', undoing
     * down to A's move would write 100 over the other lead's 700. The history
     * now clears whenever the map is replaced from the server, 'mine' too.
     */
    it('clears undo/redo when mine rebuilds the map on theirs, so an undo cannot write over their newer values', async () => {
      const save = vi.fn<EditorStoreInit['save']>(async (base): Promise<SaveResult> => (
        base === 1 ? { ok: false, reason: 'conflict', version: 5 } : { ok: true, version: base + 1 }
      ));
      const theirs = doc([item({ id: A, label: 'אוהל 1', xCm: 700 }), item({ id: B, label: 'אוהל 2', xCm: 600 })]);
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
      const { result } = setup({ save, load });
      act(() => { result.current.run('הזזה', [moveTo(A, 400)]); });
      await waitForSave();
      act(() => { result.current.run('הזזה', [moveTo(B, 900)]); });
      await waitForSave();
      expect(result.current.conflict).toEqual({ version: 5 });

      await act(async () => { await result.current.resolveConflict('mine'); });

      expect(result.current.doc.items.map((entry) => entry.xCm)).toEqual([700, 900]);
      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(false);
      act(() => { expect(result.current.undo()).toBeNull(); });
      expect(result.current.doc.items.find((entry) => entry.id === A)?.xCm).toBe(700);
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

    // Fix round 1, finding 2 (ruling 6), restated by review I5: this used to
    // redo after 'mine' and check the redo was reduced to nothing. 'mine' now
    // clears the history (see the I5 test above), so there is no redo left to
    // reduce; what stands is the lock refusal named, and nothing resent.
    it('names a genuine lock refusal after mine, and leaves nothing to redo', async () => {
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
      // The pending update (back to 100) really did differ from the server's
      // 400 — a genuine lock refusal, not a no-op — so it is named here.
      expect(result.current.notice).toBe(lockedNotice('אוהל 1'));
      expect(result.current.canRedo).toBe(false);
      act(() => { expect(result.current.redo()).toBeNull(); });

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

    // Fix round 1, findings 1 and 2, restated by review I5: this used to redo
    // after 'mine' onto an item the other lead had locked, and check the step
    // was skipped. 'mine' now clears the history, so the redo cannot reach
    // the other lead's item at all — the lock and its 700 stand, nothing sent.
    it('leaves no redo after mine to reach an item the other lead locked meanwhile', async () => {
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
      expect(result.current.canRedo).toBe(false);

      act(() => { expect(result.current.redo()).toBeNull(); });
      expect(result.current.doc.items.find((entry) => entry.id === A)?.xCm).toBe(700);

      await waitForSave();
      expect(saveFn).toHaveBeenCalledTimes(1); // only the original conflicting send — nothing sent by a redo
    });

    /* The skip a redo still meets without 'mine': an item the server dropped
       (review C2's `skipped`) leaves the map under a standing history. */
    it('says a redo was only partly applied when an item it touches has since left the map', async () => {
      const save = vi.fn<EditorStoreInit['save']>(async (base) => ({ ok: true, version: base + 1, skipped: [B] }));
      const { result } = setup({ save });
      act(() => {
        result.current.run('הזזה', [moveTo(A, 400), moveTo(B, 900)]);
        result.current.undo();
        result.current.redo();
      });
      await waitForSave();
      expect(result.current.doc.items.map((entry) => entry.id)).toEqual([A]);
      act(() => { result.current.undo(); });
      expect(result.current.doc.items[0].xCm).toBe(100);
      expect(result.current.notice).toBe(PARTLY_APPLIED);
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
