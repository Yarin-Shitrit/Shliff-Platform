/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import type { SaveResult } from '@/lib/site/editor/ops';
import { useEditorStore, type EditorStoreInit } from './use-editor-store';

/**
 * The store with shade-net ropes in it (spec Part B): the flags it derives,
 * and a conflict resolved with 'mine' that must not lose a net's angle.
 */

const A = '0b9f6a8e-1c2d-4e3f-8a9b-0c1d2e3f4a5b';
const NET = 'cccccccc-0000-4000-8000-000000000001';

function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 100, yCm: 100, widthCm: 300, depthCm: 300,
    heightCm: null, insetCm: null, ropeAngleDeg: null, sort: 0, taskId: null, notes: null, facing: 0, locked: false, ...over,
  };
}

const net = item({ id: NET, kind: 'shade', label: 'רשת צל 1', xCm: 1000, yCm: 1000, widthCm: 800, depthCm: 800, insetCm: 50 });

function doc(items: EditorItem[], defaults: EditorDoc['defaults'] = {}): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, lines: [], defaults };
}

async function waitForSave() {
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
}

function setup(over: Partial<EditorStoreInit> = {}) {
  const save = vi.fn<EditorStoreInit['save']>(async (base) => ({ ok: true, version: base + 1 }));
  const load = vi.fn<EditorStoreInit['load']>();
  const init: EditorStoreInit = { doc: doc([item({ id: A })]), version: 0, save, load, ...over };
  const hook = renderHook(() => useEditorStore(init));
  return { ...hook, save: (over.save ?? save) as typeof save };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('ropes in the store', () => {
  it('keeps a net’s rope angle when "mine" turns a pending add into an update', async () => {
    const conflicting = vi.fn<EditorStoreInit['save']>(async (base): Promise<SaveResult> => (
      base === 0 ? { ok: false, reason: 'conflict', version: 5 } : { ok: true, version: base + 1 }
    ));
    // The other lead's map already has the net, following the camp's angle.
    const theirs = doc([item({ id: A }), net]);
    const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
    const { result } = setup({ save: conflicting, load });
    act(() => { result.current.run('הוספה', [{ type: 'add', item: { ...net, ropeAngleDeg: 45 } }]); });
    await waitForSave();
    expect(result.current.conflict).toEqual({ version: 5 });

    await act(async () => { await result.current.resolveConflict('mine'); });

    expect(result.current.doc.items.find((entry) => entry.id === NET)?.ropeAngleDeg).toBe(45);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(conflicting).toHaveBeenCalledTimes(2);
    expect(conflicting.mock.calls[1][1]).toEqual([{ type: 'update', id: NET, patch: { ropeAngleDeg: 45 } }]);
  });

  it('flags what stands in a net’s rope band once the camp has an angle, and nothing before', () => {
    // 300 × 300 at (750, 1100): half in the band west of the cloth (which starts at 1000).
    const inBand = item({ id: A, xCm: 750, yCm: 1100 });
    const before = setup({ doc: doc([net, inBand]) }).result.current.flags;
    expect(before.ropePairs).toEqual([]);
    expect(before.onRopes.size).toBe(0);
    const roped = setup({
      doc: doc([net, inBand], { shade: { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 } }),
    }).result.current.flags;
    expect(roped.ropePairs).toEqual([[NET, A]]);
    expect([...roped.onRopes]).toEqual([A]);
    expect(roped.outside.size).toBe(0); // the footprint (7–21 m) stays inside the fence
  });
});
