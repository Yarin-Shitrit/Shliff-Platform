import { describe, it, expect } from 'vitest';
import type { SiteLinePoint } from '@/db/schema/site';
import type { EditorDoc, EditorItem, EditorLine } from './model';
import { nextLabel } from './model';
import {
  applyOps, coalesceOps, invertOps, kindSizeRefusal, lineEndsRefusal, linePatchRefusal, lockRefusal, newItemRefusal,
  newLineRefusal, opRefusal, patchRefusal, rekindRefusal, storedPatch, type SiteOp,
} from './ops';

export function item(over: Partial<EditorItem> = {}): EditorItem {
  return {
    id: '5b0f3c1e-2a4d-4f6b-9c8e-1d2a3b4c5d6e', kind: 'tent', label: 'אוהל 1',
    xCm: 0, yCm: 0, widthCm: 300, depthCm: 300, heightCm: null, insetCm: null,
    sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

describe('refusals', () => {
  it('accept an ordinary patch', () => {
    expect(patchRefusal({ xCm: 150, yCm: -50, widthCm: 350, heightCm: 180, locked: true })).toBeNull();
  });

  it('refuse what plan.ts has always refused, in the same words', () => {
    expect(patchRefusal({ label: '   ' })).toMatch(/^an item must have a label/);
    expect(patchRefusal({ widthCm: 5 })).toMatch(/^an item side must be/);
    expect(patchRefusal({ depthCm: 300.5 })).toMatch(/^an item side must be/);
    expect(patchRefusal({ xCm: 1.5 })).toMatch(/^an item position must be/);
    expect(patchRefusal({ insetCm: -1 })).toMatch(/^a shade inset must be/);
    expect(patchRefusal({ kind: 'spaceship' as never })).toMatch(/^unknown item kind/);
  });

  it('refuse a label made only of marks that trim() does not remove', () => {
    expect(patchRefusal({ label: '‏' })).toMatch(/^an item must have a label/);
  });

  it('refuse a height outside 10 cm to 20 m, but accept null (the kind\'s height)', () => {
    expect(patchRefusal({ heightCm: 5 })).toMatch(/^an item height must be/);
    expect(patchRefusal({ heightCm: 2_001 })).toMatch(/^an item height must be/);
    expect(patchRefusal({ heightCm: null })).toBeNull();
  });

  it('refuse a new item whose id is not a uuid', () => {
    expect(newItemRefusal(item())).toBeNull();
    expect(newItemRefusal(item({ id: 'x1' }))).toMatch(/^an item id must be a uuid/);
  });

  it('refuse a new item with a negative or fractional sort', () => {
    expect(newItemRefusal(item({ sort: -1 }))).toMatch(/^an item sort must be/);
    expect(newItemRefusal(item({ sort: 1.5 }))).toMatch(/^an item sort must be/);
    expect(newItemRefusal(item({ sort: 7 }))).toBeNull();
  });

  it('refuse a kind default with a bad side', () => {
    expect(kindSizeRefusal({ widthCm: 300, depthCm: 300, heightCm: 200, insetCm: null })).toBeNull();
    expect(kindSizeRefusal({ widthCm: 300, depthCm: 0, heightCm: 200, insetCm: null })).toMatch(/^a kind default must be/);
  });

  it('check every kind of op, and name an unknown one', () => {
    expect(opRefusal({ type: 'remove', id: 'anything' })).toBeNull();
    expect(opRefusal({ type: 'setKindDefault', kind: 'tent', size: null })).toBeNull();
    expect(opRefusal({ type: 'update', id: 'a', patch: { widthCm: 1 } })).toMatch(/^an item side must be/);
    expect(opRefusal({ type: 'explode' } as never)).toMatch(/^unknown operation/);
  });
});

describe('the lock', () => {
  it('refuses a move on a locked item', () => {
    expect(lockRefusal(true, { xCm: 900 })).toBe('that item is locked');
  });

  it('allows a rename on a locked item', () => {
    expect(lockRefusal(true, { label: 'אוהל הצוות' })).toBeNull();
  });

  it('allows unlocking and moving in the same patch', () => {
    expect(lockRefusal(true, { locked: false, xCm: 900 })).toBeNull();
  });

  it('allows a move on an item that is not locked', () => {
    expect(lockRefusal(false, { xCm: 900 })).toBeNull();
  });
});

describe('the next label', () => {
  it('is one past the highest number of its kind, counting an unnumbered one as 1', () => {
    expect(nextLabel([], 'tent')).toBe('אוהל 1');
    expect(nextLabel([item({ label: 'אוהל 7' }), item({ label: 'אוהל 3' })], 'tent')).toBe('אוהל 8');
    expect(nextLabel([item({ kind: 'kitchen', label: 'מטבח' })], 'kitchen')).toBe('מטבח 2');
    expect(nextLabel([item({ label: 'אוהל 7' })], 'sofa')).toBe('ספה 1');
  });
});

const A = item({ id: 'a', label: 'אוהל 1', xCm: 100, yCm: 100, sort: 0 });
const B = item({ id: 'b', label: 'אוהל 2', xCm: 500, yCm: 100, sort: 1 });
const C = item({ id: 'c', kind: 'sofa', label: 'ספה 1', widthCm: 200, depthCm: 90, sort: 2 });
const TENT_350 = { widthCm: 350, depthCm: 300, heightCm: 210, insetCm: null };

function docOf(items: EditorItem[], defaults: EditorDoc['defaults'] = {}): EditorDoc {
  return { plot: { id: 'p', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, lines: [], defaults };
}

describe('applying ops', () => {
  it('applies each kind of op in order, without touching what it was given', () => {
    const doc = docOf([A, B]);
    const before = structuredClone(doc);
    const { doc: next, skipped } = applyOps(doc, [
      { type: 'update', id: 'a', patch: { xCm: 150, heightCm: 180 } },
      { type: 'add', item: C },
      { type: 'remove', id: 'b' },
      { type: 'setKindDefault', kind: 'tent', size: TENT_350 },
    ]);
    expect(skipped).toEqual([]);
    expect(next.items).toEqual([{ ...A, xCm: 150, heightCm: 180 }, C]);
    expect(next.defaults).toEqual({ tent: TENT_350 });
    expect(doc).toEqual(before);
  });

  it('keeps an item it did not change as the same object', () => {
    const { doc: next } = applyOps(docOf([A, B]), [{ type: 'update', id: 'a', patch: { xCm: 150 } }]);
    expect(next.items[1]).toBe(B);
  });

  it('puts an added item in drawing order, so an undone removal lands where it was', () => {
    const removed = applyOps(docOf([A, B, C]), [{ type: 'remove', id: 'b' }]).doc;
    const back = applyOps(removed, [{ type: 'add', item: B }]).doc;
    expect(back.items.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops a kind default when its size is null', () => {
    const { doc: next } = applyOps(docOf([], { tent: TENT_350 }), [{ type: 'setKindDefault', kind: 'tent', size: null }]);
    expect(next.defaults).toStrictEqual({});
  });

  it('skips ops on missing items, and says which, without throwing', () => {
    const cannot: SiteOp[] = [
      { type: 'update', id: 'gone', patch: { xCm: 10 } },
      { type: 'remove', id: 'gone' },
      { type: 'add', item: A },
    ];
    const { doc: next, skipped } = applyOps(docOf([A, B]), [
      ...cannot,
      { type: 'update', id: 'b', patch: { yCm: 900 } },
    ]);
    expect(skipped).toEqual(cannot);
    expect(next.items).toEqual([A, { ...B, yCm: 900 }]);
  });

  it('lets an undo run after its item was removed elsewhere', () => {
    const doc = docOf([A, B]);
    const undoOps = invertOps(doc, [{ type: 'update', id: 'a', patch: { xCm: 700 } }]);
    // The other lead removed the tent; this lead reloaded their version after a conflict.
    const reloaded = docOf([B]);
    const { doc: next, skipped } = applyOps(reloaded, undoOps);
    expect(next).toEqual(reloaded);
    expect(skipped).toEqual(undoOps);
  });
});

describe('inverting ops', () => {
  const SOFA_220 = { widthCm: 220, depthCm: 90, heightCm: 80, insetCm: null };
  const MIXED: SiteOp[] = [
    { type: 'update', id: 'a', patch: { xCm: 150, label: 'אוהל הצוות' } },
    { type: 'add', item: C },
    { type: 'remove', id: 'b' },
    { type: 'setKindDefault', kind: 'sofa', size: null },
    { type: 'setKindDefault', kind: 'tent', size: TENT_350 },
  ];

  it('reverses each kind of op, last first', () => {
    expect(invertOps(docOf([A, B], { sofa: SOFA_220 }), MIXED)).toEqual([
      { type: 'setKindDefault', kind: 'tent', size: null },
      { type: 'setKindDefault', kind: 'sofa', size: SOFA_220 },
      { type: 'add', item: B },
      { type: 'remove', id: 'c' },
      { type: 'update', id: 'a', patch: { xCm: 100, label: 'אוהל 1' } },
    ]);
  });

  it('takes the doc back to where it started', () => {
    const doc = docOf([A, B], { sofa: SOFA_220 });
    const after = applyOps(doc, MIXED).doc;
    expect(applyOps(after, invertOps(doc, MIXED)).doc).toStrictEqual(doc);
  });

  it('undoes two edits to one item back to the first value', () => {
    expect(invertOps(docOf([A]), [
      { type: 'update', id: 'a', patch: { xCm: 150 } },
      { type: 'update', id: 'a', patch: { xCm: 200, yCm: 300 } },
    ])).toEqual([
      { type: 'update', id: 'a', patch: { xCm: 150, yCm: 100 } },
      { type: 'update', id: 'a', patch: { xCm: 100 } },
    ]);
  });

  it('has nothing to undo for an op that was skipped or changed nothing', () => {
    expect(invertOps(docOf([A]), [
      { type: 'remove', id: 'gone' },
      { type: 'update', id: 'a', patch: { xCm: 100 } },
      { type: 'setKindDefault', kind: 'sofa', size: null },
    ])).toEqual([]);
  });
});

describe('coalescing ops', () => {
  it('merges updates to one item, later fields winning, in first-seen order', () => {
    expect(coalesceOps([
      { type: 'update', id: 'a', patch: { xCm: 1 } },
      { type: 'update', id: 'b', patch: { yCm: 2 } },
      { type: 'update', id: 'a', patch: { xCm: 3, yCm: 4 } },
    ])).toEqual([
      { type: 'update', id: 'a', patch: { xCm: 3, yCm: 4 } },
      { type: 'update', id: 'b', patch: { yCm: 2 } },
    ]);
  });

  it('folds updates into the add before them', () => {
    expect(coalesceOps([
      { type: 'add', item: C },
      { type: 'update', id: 'c', patch: { xCm: 400 } },
      { type: 'update', id: 'c', patch: { label: 'ספה ליד המדורה' } },
    ])).toEqual([{ type: 'add', item: { ...C, xCm: 400, label: 'ספה ליד המדורה' } }]);
  });

  it('sends nothing for an item added and removed in one batch', () => {
    expect(coalesceOps([
      { type: 'update', id: 'a', patch: { xCm: 1 } },
      { type: 'add', item: C },
      { type: 'update', id: 'c', patch: { xCm: 400 } },
      { type: 'remove', id: 'c' },
      { type: 'remove', id: 'b' },
    ])).toEqual([
      { type: 'update', id: 'a', patch: { xCm: 1 } },
      { type: 'remove', id: 'b' },
    ]);
  });

  it('keeps a removal ahead of the add that undoes it', () => {
    expect(coalesceOps([
      { type: 'remove', id: 'b' },
      { type: 'add', item: B },
      { type: 'update', id: 'b', patch: { xCm: 900 } },
    ])).toEqual([
      { type: 'remove', id: 'b' },
      { type: 'add', item: { ...B, xCm: 900 } },
    ]);
  });

  it('keeps an unlock ahead of the removal it allows', () => {
    const ops: SiteOp[] = [
      { type: 'update', id: 'a', patch: { locked: false } },
      { type: 'remove', id: 'a' },
    ];
    expect(coalesceOps(ops)).toEqual(ops);
  });

  it('never merges a relock into an earlier update of the same id', () => {
    expect(coalesceOps([
      { type: 'update', id: 'a', patch: { locked: false } },
      { type: 'update', id: 'a', patch: { xCm: 900 } },
      { type: 'update', id: 'a', patch: { locked: true } },
    ])).toEqual([
      { type: 'update', id: 'a', patch: { locked: false, xCm: 900 } },
      { type: 'update', id: 'a', patch: { locked: true } },
    ]);
  });

  it('keeps only the last default of a kind, where the first one was', () => {
    expect(coalesceOps([
      { type: 'setKindDefault', kind: 'tent', size: TENT_350 },
      { type: 'update', id: 'a', patch: { xCm: 1 } },
      { type: 'setKindDefault', kind: 'tent', size: null },
    ])).toEqual([
      { type: 'setKindDefault', kind: 'tent', size: null },
      { type: 'update', id: 'a', patch: { xCm: 1 } },
    ]);
  });

  it('does not change the ops it was given', () => {
    const ops: SiteOp[] = [{ type: 'add', item: C }, { type: 'update', id: 'c', patch: { xCm: 400 } }];
    const before = structuredClone(ops);
    coalesceOps(ops);
    expect(ops).toEqual(before);
  });

  it('lands the same doc as the ops it replaced', () => {
    const doc = docOf([A, B]);
    const ops: SiteOp[] = [
      { type: 'update', id: 'a', patch: { xCm: 150 } },
      { type: 'add', item: C },
      { type: 'update', id: 'c', patch: { yCm: 700 } },
      { type: 'update', id: 'a', patch: { yCm: 250 } },
      { type: 'remove', id: 'b' },
      { type: 'add', item: B },
      { type: 'update', id: 'b', patch: { label: 'אוהל המטבח' } },
    ];
    expect(applyOps(doc, coalesceOps(ops)).doc).toEqual(applyOps(doc, ops).doc);
  });
});

describe('the stored patch', () => {
  it('trims the label', () => {
    expect(storedPatch(item(), { label: '  אוהל 1  ' }).label).toBe('אוהל 1');
  });

  it('trims non-blank notes rather than clearing them', () => {
    expect(storedPatch(item(), { notes: '  יש להביא עוד יתדות  ' }).notes).toBe('יש להביא עוד יתדות');
  });

  it('keeps an explicit null for notes', () => {
    expect(storedPatch(item(), { notes: null }).notes).toBeNull();
  });

  it('keeps a net’s own explicit inset', () => {
    expect(storedPatch(item({ kind: 'shade', insetCm: 50 }), { insetCm: 80 }).insetCm).toBe(80);
  });

  it('clears the inset when a net becomes a sofa', () => {
    expect(storedPatch(item({ kind: 'shade', insetCm: 50 }), { kind: 'sofa' }).insetCm).toBeNull();
  });

  it('clears notes made only of marks that trim() does not remove', () => {
    expect(storedPatch(item(), { notes: '‏' }).notes).toBeNull();
  });

  it('clears whitespace-only notes', () => {
    expect(storedPatch(item(), { notes: '  ' }).notes).toBeNull();
  });

  it('gives a net the default inset for an explicit null', () => {
    expect(storedPatch(item({ kind: 'shade' }), { insetCm: null }).insetCm).toBe(50);
  });

  it('gives a net the default inset when it is gaining it from an existing null', () => {
    expect(storedPatch(item({ kind: 'shade', insetCm: null }), { xCm: 10 }).insetCm).toBe(50);
  });

  it('clears the inset when a patch changes the kind of an item that had one', () => {
    expect(storedPatch(item({ kind: 'sofa', insetCm: 40 }), { kind: 'tent' }).insetCm).toBeNull();
  });

  it('clears the inset when a patch changes it on anything but a net', () => {
    expect(storedPatch(item({ kind: 'sofa', insetCm: 40 }), { insetCm: 100 }).insetCm).toBeNull();
  });

  it('passes unrelated fields through unchanged', () => {
    expect(storedPatch(item(), { xCm: 500, taskId: 'a-task' })).toEqual({ xCm: 500, taskId: 'a-task' });
  });
});

/* ── the pipes and cables (site_lines) ────────────────────────────────── */

const LINE_A = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const LINE_B = '8b2c3d4e-5f60-4b7c-9d8e-0f1a2b3c4d5e';
const TANK_ID = '9c3d4e5f-6071-4c8d-ae9f-1a2b3c4d5e6f';
const SHOWER_ID = 'ad4e5f60-7182-4d9e-bfa0-2b3c4d5e6f70';

function lineOf(over: Partial<EditorLine> = {}): EditorLine {
  return { id: LINE_A, kind: 'water', label: 'צינור מים 1', fromId: TANK_ID, toId: SHOWER_ID, points: [], sort: 0, notes: null, ...over };
}

function docWithLines(lines: EditorLine[]): EditorDoc {
  return {
    ...docOf([item({ id: TANK_ID, kind: 'water' }), item({ id: SHOWER_ID, kind: 'shower', xCm: 500 })]),
    lines,
  };
}

describe('line refusals', () => {
  it('accept a straight line and one with whole-centimetre bends', () => {
    expect(newLineRefusal(lineOf())).toBeNull();
    expect(newLineRefusal(lineOf({ points: [[50, 300], [550, 300]] }))).toBeNull();
    expect(linePatchRefusal({ label: 'הצינור לכיור', notes: null })).toBeNull();
  });

  it('refuse a blank label, a fractional bend, a bend past the map, an id that is not a uuid, and an unknown kind', () => {
    expect(linePatchRefusal({ label: '  ' })).toMatch(/^a line must have a label/);
    expect(linePatchRefusal({ points: [[1.5, 2]] })).toMatch(/^a line bend must be/);
    expect(linePatchRefusal({ points: [[60_000, 0]] })).toMatch(/^a line bend must be/);
    expect(linePatchRefusal({ points: [[1, 2, 3]] as never })).toMatch(/^a line bend must be/);
    expect(linePatchRefusal({ fromId: 'x' })).toMatch(/^a line end must be/);
    expect(newLineRefusal(lineOf({ id: 'l1' }))).toMatch(/^a line id must be a uuid/);
    expect(newLineRefusal(lineOf({ kind: 'gas' as never }))).toMatch(/^unknown line kind/);
    expect(newLineRefusal(lineOf({ sort: -1 }))).toMatch(/^a line sort must be/);
  });

  it('check the ends against the map: both there, different, both carrying the utility', () => {
    const tank = { id: TANK_ID, kind: 'water' as const };
    const shower = { id: SHOWER_ID, kind: 'shower' as const };
    const toilet = { id: LINE_B, kind: 'toilet' as const };
    expect(lineEndsRefusal('water', tank, shower)).toBeNull();
    expect(lineEndsRefusal('water', tank, undefined)).toMatch(/^a line end is not an item on this map/);
    expect(lineEndsRefusal('water', tank, tank)).toMatch(/^a line must join two different items/);
    expect(lineEndsRefusal('water', tank, toilet)).toMatch(/^a water pipe joins only/);
    expect(lineEndsRefusal('power', tank, shower)).toMatch(/^a power cable joins only/);
  });

  it('keep an item with a line attached on a kind the line can reach', () => {
    expect(rekindRefusal('sink', [{ kind: 'water' }])).toBeNull();
    expect(rekindRefusal('tent', [{ kind: 'water' }])).toMatch(/^an item with a line attached keeps/);
    expect(rekindRefusal('tent', [])).toBeNull();
  });

  it('go through opRefusal like every other op', () => {
    expect(opRefusal({ type: 'addLine', line: lineOf() })).toBeNull();
    expect(opRefusal({ type: 'updateLine', id: LINE_A, patch: { label: ' ' } })).toMatch(/^a line must have a label/);
    expect(opRefusal({ type: 'removeLine', id: LINE_A })).toBeNull();
  });
});

describe('applying line ops', () => {
  it('adds, updates and removes a line, and skips what names a line that is not there', () => {
    const start = docWithLines([]);
    const added = applyOps(start, [{ type: 'addLine', line: lineOf() }]);
    expect(added.skipped).toEqual([]);
    expect(added.doc.lines).toEqual([lineOf()]);
    // The items are untouched — the same array.
    expect(added.doc.items).toBe(start.items);

    const bent = applyOps(added.doc, [{ type: 'updateLine', id: LINE_A, patch: { points: [[50, 300]], label: 'לכיור' } }]);
    expect(bent.doc.lines[0]).toMatchObject({ points: [[50, 300]], label: 'לכיור', fromId: TANK_ID });

    const gone = applyOps(bent.doc, [{ type: 'removeLine', id: LINE_A }, { type: 'removeLine', id: LINE_B }]);
    expect(gone.doc.lines).toEqual([]);
    expect(gone.skipped).toEqual([{ type: 'removeLine', id: LINE_B }]);
  });

  it('keeps the bends its own: the doc never shares an array with the op', () => {
    const points: SiteLinePoint[] = [[50, 300]];
    const { doc: next } = applyOps(docWithLines([]), [{ type: 'addLine', line: lineOf({ points }) }]);
    points[0][0] = 999;
    expect(next.lines[0].points).toEqual([[50, 300]]);
  });

  it('inverts every line op, so apply then undo is the starting doc', () => {
    const start = docWithLines([lineOf({ points: [[50, 300]] })]);
    const ops: SiteOp[] = [
      { type: 'updateLine', id: LINE_A, patch: { points: [[50, 400]], notes: 'לאורך הגדר' } },
      { type: 'addLine', line: lineOf({ id: LINE_B, label: 'צינור מים 2', sort: 1 }) },
      { type: 'removeLine', id: LINE_A },
    ];
    const inverse = invertOps(start, ops);
    expect(inverse.map((op) => op.type)).toEqual(['addLine', 'removeLine', 'updateLine']);
    const after = applyOps(start, ops).doc;
    expect(applyOps(after, inverse).doc.lines).toEqual(start.lines);
  });

  it('has nothing to undo for an update that changes nothing, bends included', () => {
    const start = docWithLines([lineOf({ points: [[50, 300]] })]);
    expect(invertOps(start, [{ type: 'updateLine', id: LINE_A, patch: { points: [[50, 300]] } }])).toEqual([]);
  });
});

describe('coalescing line ops', () => {
  it('folds updates into an add, merges updates, and drops an add that was removed', () => {
    expect(coalesceOps([
      { type: 'addLine', line: lineOf() },
      { type: 'updateLine', id: LINE_A, patch: { points: [[50, 300]] } },
      { type: 'updateLine', id: LINE_A, patch: { label: ' לכיור ' } },
    ])).toEqual([{ type: 'addLine', line: lineOf({ points: [[50, 300]], label: ' לכיור ' }) }]);

    expect(coalesceOps([
      { type: 'updateLine', id: LINE_A, patch: { points: [[50, 300]] } },
      { type: 'updateLine', id: LINE_A, patch: { notes: 'x' } },
    ])).toEqual([{ type: 'updateLine', id: LINE_A, patch: { points: [[50, 300]], notes: 'x' } }]);

    expect(coalesceOps([
      { type: 'addLine', line: lineOf() },
      { type: 'remove', id: SHOWER_ID },
      { type: 'removeLine', id: LINE_A },
    ])).toEqual([{ type: 'remove', id: SHOWER_ID }]);
  });

  it('keeps a line op and an item op with the same id apart', () => {
    // Never the case in practice — ids are uuids — but the two maps must not cross.
    expect(coalesceOps([
      { type: 'add', item: item({ id: LINE_A }) },
      { type: 'removeLine', id: LINE_A },
    ])).toHaveLength(2);
  });
});
