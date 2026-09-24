import { describe, it, expect } from 'vitest';
import {
  addOps, alignOps, distributeOps, duplicateOps, lockOps, moveOps, patchOps, removeOps, resetSizeOps,
  resizeKindOps, rowOps, setKindDefaultOps, setRectOps, turnOps, uniformSize,
} from './commands';
import type { EditorDoc, EditorItem } from './model';
import { applyOps, invertOps, type SiteOp } from './ops';

function make(over: Partial<EditorItem> & Pick<EditorItem, 'id' | 'label'>): EditorItem {
  return {
    kind: 'tent', xCm: 0, yCm: 0, widthCm: 300, depthCm: 300, heightCm: null, insetCm: null,
    sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

/*
 * A 26 × 24 m plot, drawn on graph paper (x east, y south, centimetres):
 *   t1, t2  tents 3 × 3 at (100,100) and (500,100)
 *   c1      a caravan 7 × 2.5 at (100,600), 2.6 m tall
 *   s1      a shade net 8 × 8 at (1200,1200), 50 cm strip
 *   lk      a locked tent at (900,100)
 *   f1      a fridge 0.7 × 0.7 at (2000,300)
 * Items are in drawing order (sort 0..5), as the server lists them.
 */
const T1 = make({ id: 't1', label: 'אוהל 1', xCm: 100, yCm: 100, sort: 0 });
const T2 = make({ id: 't2', label: 'אוהל 2', xCm: 500, yCm: 100, sort: 1 });
const C1 = make({
  id: 'c1', kind: 'caravan', label: 'קראוון 1', xCm: 100, yCm: 600, widthCm: 700, depthCm: 250, heightCm: 260, sort: 2,
});
const S1 = make({
  id: 's1', kind: 'shade', label: 'רשת צל 1', xCm: 1200, yCm: 1200, widthCm: 800, depthCm: 800, insetCm: 50, sort: 3,
});
const LK = make({ id: 'lk', label: 'אוהל 3', xCm: 900, yCm: 100, locked: true, sort: 4 });
const F1 = make({ id: 'f1', kind: 'fridge', label: 'מקרר 1', xCm: 2000, yCm: 300, widthCm: 70, depthCm: 70, sort: 5 });

const DOC: EditorDoc = {
  plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 },
  items: [T1, T2, C1, S1, LK, F1],
  defaults: {},
};

const TENT_350 = { widthCm: 350, depthCm: 300, heightCm: 210, insetCm: null };

function ids(...list: string[]): () => string {
  const queue = [...list];
  return () => {
    const next = queue.shift();
    if (next === undefined) throw new Error('the test ran out of ids');
    return next;
  };
}

describe('moving', () => {
  it('moves every unlocked item named and skips the locked and the gone', () => {
    expect(moveOps(DOC, ['t1', 'lk', 'nope'], 50, -50)).toEqual([
      { type: 'update', id: 't1', patch: { xCm: 150, yCm: 50 } },
    ]);
  });

  it('sends only the coordinate that changes', () => {
    expect(moveOps(DOC, ['t1', 't2'], 50, 0)).toEqual([
      { type: 'update', id: 't1', patch: { xCm: 150 } },
      { type: 'update', id: 't2', patch: { xCm: 550 } },
    ]);
  });

  it('is nothing when the move is nothing', () => {
    expect(moveOps(DOC, ['t1'], 0, 0)).toEqual([]);
    expect(moveOps(DOC, ['t1'], 0.4, -0.4)).toEqual([]);
  });
});

describe('setting a rectangle', () => {
  it('sends the sides and corner that change', () => {
    expect(setRectOps(DOC, 't1', { xCm: 100, yCm: 100, widthCm: 350, depthCm: 300 })).toEqual([
      { type: 'update', id: 't1', patch: { widthCm: 350 } },
    ]);
  });

  it('leaves a locked item, and an unchanged one, alone', () => {
    expect(setRectOps(DOC, 'lk', { xCm: 0, yCm: 0, widthCm: 350, depthCm: 300 })).toEqual([]);
    expect(setRectOps(DOC, 't1', { xCm: 100, yCm: 100, widthCm: 300, depthCm: 300 })).toEqual([]);
  });
});

describe('turning', () => {
  it('turns about the middle: the caravan at (100,600) 700 × 250 becomes (325,375) 250 × 700', () => {
    expect(turnOps(DOC, ['c1', 't1', 'lk'])).toEqual([
      { type: 'update', id: 'c1', patch: { xCm: 325, yCm: 375, widthCm: 250, depthCm: 700 } },
    ]);
  });
});

describe('adding', () => {
  it('adds at the kind’s size with the next label, drawn on top', () => {
    expect(addOps(DOC, 'tent', { xCm: 1500, yCm: 200 }, 'n1')).toEqual([{
      type: 'add',
      item: {
        id: 'n1', kind: 'tent', label: 'אוהל 4', xCm: 1500, yCm: 200, widthCm: 300, depthCm: 300,
        heightCm: null, insetCm: null, sort: 6, taskId: null, notes: null, locked: false,
      },
    }]);
  });

  it('uses the camp’s own size, and gives a net a strip even when that size has none', () => {
    const doc = { ...DOC, defaults: { shade: { widthCm: 600, depthCm: 400, heightCm: 280, insetCm: null } } };
    const [op] = addOps(doc, 'shade', { xCm: 0, yCm: 1500 }, 'n2');
    expect(op).toMatchObject({
      type: 'add',
      item: { label: 'רשת צל 2', widthCm: 600, depthCm: 400, heightCm: null, insetCm: 50 },
    });
  });

  it('does not add an id that is already on the map', () => {
    expect(addOps(DOC, 'tent', { xCm: 0, yCm: 0 }, 't1')).toEqual([]);
  });
});

describe('removing', () => {
  it('removes the unlocked items named', () => {
    expect(removeOps(DOC, ['t1', 'lk', 'nope'])).toEqual([{ type: 'remove', id: 't1' }]);
  });
});

describe('duplicating', () => {
  it('puts a copy east of the original when the ground there is clear', () => {
    expect(duplicateOps(DOC, ['f1'], ids('n1'))).toEqual({
      ops: [{ type: 'add', item: { ...F1, id: 'n1', label: 'מקרר 2', xCm: 2170, sort: 6 } }],
      ids: ['n1'],
    });
  });

  it('tries south when east is past the fence', () => {
    const bar = make({ id: 'b1', kind: 'bar', label: 'בר 1', xCm: 2400, yCm: 0, widthCm: 200, depthCm: 100 });
    const doc = { ...DOC, items: [bar] };
    expect(duplicateOps(doc, ['b1'], ids('n1')).ops).toEqual([
      { type: 'add', item: { ...bar, id: 'n1', label: 'בר 2', yCm: 200, sort: 1 } },
    ]);
  });

  it('falls back to a metre east and south when no side is clear, and numbers each copy', () => {
    // East of t1+t2 is the locked tent, south is the caravan, west and north are past the fence.
    expect(duplicateOps(DOC, ['t1', 't2'], ids('n1', 'n2'))).toEqual({
      ops: [
        { type: 'add', item: { ...T1, id: 'n1', label: 'אוהל 4', xCm: 200, yCm: 200, sort: 6 } },
        { type: 'add', item: { ...T2, id: 'n2', label: 'אוהל 5', xCm: 600, yCm: 200, sort: 7 } },
      ],
      ids: ['n1', 'n2'],
    });
  });

  it('copies a locked item, and the copy is unlocked', () => {
    const { ops } = duplicateOps(DOC, ['lk'], ids('n1'));
    expect(ops).toEqual([{ type: 'add', item: { ...LK, id: 'n1', label: 'אוהל 4', xCm: 1300, sort: 6, locked: false } }]);
  });

  it('copies nothing when nothing named is there', () => {
    expect(duplicateOps(DOC, ['nope'], ids())).toEqual({ ops: [], ids: [] });
  });
});

describe('locking', () => {
  it('changes only the items whose lock differs', () => {
    expect(lockOps(DOC, ['t1', 'lk'], true)).toEqual([{ type: 'update', id: 't1', patch: { locked: true } }]);
    expect(lockOps(DOC, ['t1', 'lk'], false)).toEqual([{ type: 'update', id: 'lk', patch: { locked: false } }]);
  });
});

describe('patching one item', () => {
  it('trims a label and drops what does not change', () => {
    expect(patchOps(DOC, 't1', { label: '  אוהל הצוות ', xCm: 100 })).toEqual([
      { type: 'update', id: 't1', patch: { label: 'אוהל הצוות' } },
    ]);
    expect(patchOps(DOC, 't1', { label: 'אוהל 1', notes: '   ' })).toEqual([]);
  });

  it('keeps a locked item where it is unless the same patch unlocks it', () => {
    expect(patchOps(DOC, 'lk', { xCm: 950 })).toEqual([]);
    expect(patchOps(DOC, 'lk', { xCm: 950, locked: false })).toEqual([
      { type: 'update', id: 'lk', patch: { xCm: 950, locked: false } },
    ]);
  });

  it('renames a locked item even when the form sends its unchanged position', () => {
    expect(patchOps(DOC, 'lk', { label: 'אוהל הצוות', xCm: 900, yCm: 100 })).toEqual([
      { type: 'update', id: 'lk', patch: { label: 'אוהל הצוות' } },
    ]);
  });

  it('gives a net a strip and takes it away from anything else, as the server does', () => {
    expect(patchOps(DOC, 't1', { kind: 'shade' })).toEqual([
      { type: 'update', id: 't1', patch: { kind: 'shade', insetCm: 50 } },
    ]);
    expect(patchOps(DOC, 's1', { kind: 'sofa' })).toEqual([
      { type: 'update', id: 's1', patch: { kind: 'sofa', insetCm: null } },
    ]);
    expect(patchOps(DOC, 's1', { insetCm: null })).toEqual([]);
  });

  it('can put an item back on its kind’s height', () => {
    expect(patchOps(DOC, 'c1', { heightCm: null })).toEqual([{ type: 'update', id: 'c1', patch: { heightCm: null } }]);
  });

  it('is nothing for an item that is not there', () => {
    expect(patchOps(DOC, 'nope', { label: 'x' })).toEqual([]);
  });

  it('undoes a kind change back to the net’s own inset, not the default', () => {
    // s1 is a net with inset 70 (not the default 50): shade → sofa must undo to 70, not 50.
    const doc = { ...DOC, items: DOC.items.map((entry) => (entry.id === 's1' ? { ...entry, insetCm: 70 } : entry)) };
    const ops = patchOps(doc, 's1', { kind: 'sofa' });
    expect(ops).toEqual([{ type: 'update', id: 's1', patch: { kind: 'sofa', insetCm: null } }]);
    const after = applyOps(doc, ops);
    expect(after.skipped).toEqual([]);
    expect(applyOps(after.doc, invertOps(doc, ops)).doc).toStrictEqual(doc);
    const s1After = applyOps(after.doc, invertOps(doc, ops)).doc.items.find((entry) => entry.id === 's1');
    expect(s1After).toEqual({ ...doc.items.find((entry) => entry.id === 's1'), insetCm: 70 });
  });
});

describe('sizing one kind across a selection', () => {
  it('resizes each unlocked item of the kind about its own middle', () => {
    expect(resizeKindOps(DOC, ['t1', 't2', 'lk', 'c1'], 'tent', { widthCm: 350 })).toEqual([
      { type: 'update', id: 't1', patch: { xCm: 75, widthCm: 350 } },
      { type: 'update', id: 't2', patch: { xCm: 475, widthCm: 350 } },
    ]);
    expect(resizeKindOps(DOC, ['t1'], 'tent', { depthCm: 250 })).toEqual([
      { type: 'update', id: 't1', patch: { yCm: 125, depthCm: 250 } },
    ]);
  });

  it('writes a height only when it differs from the one the item shows', () => {
    expect(resizeKindOps(DOC, ['t1'], 'tent', { heightCm: 200 })).toEqual([]);
    expect(resizeKindOps(DOC, ['t1'], 'tent', { heightCm: 180 })).toEqual([
      { type: 'update', id: 't1', patch: { heightCm: 180 } },
    ]);
    expect(resizeKindOps(DOC, ['c1'], 'caravan', { heightCm: 260 })).toEqual([]);
  });

  it('reads a kind’s sizes as one number where they agree and null where they are mixed', () => {
    expect(uniformSize(DOC, ['t1', 't2', 'lk', 'c1'], 'tent')).toEqual({ widthCm: 300, depthCm: 300, heightCm: 200 });
    const mixed: EditorDoc = {
      ...DOC,
      items: DOC.items.map((entry) => (
        entry.id === 't2' ? { ...entry, widthCm: 350 } : entry.id === 'lk' ? { ...entry, heightCm: 180 } : entry
      )),
    };
    expect(uniformSize(mixed, ['t1', 't2', 'lk'], 'tent')).toEqual({ widthCm: null, depthCm: 300, heightCm: null });
    expect(uniformSize(DOC, ['t1'], 'sofa')).toEqual({ widthCm: null, depthCm: null, heightCm: null });
  });
});

describe('back to the default', () => {
  it('puts the height back on the kind when the sides already match', () => {
    expect(resetSizeOps(DOC, ['c1'])).toEqual([{ type: 'update', id: 'c1', patch: { heightCm: null } }]);
  });

  it('takes the camp’s own size about the middle', () => {
    const doc = { ...DOC, defaults: { tent: TENT_350 } };
    expect(resetSizeOps(doc, ['t1', 'lk'])).toEqual([{ type: 'update', id: 't1', patch: { xCm: 75, widthCm: 350 } }]);
  });

  it('is nothing for a net already at its kind’s size and strip', () => {
    expect(resetSizeOps(DOC, ['s1'])).toEqual([]);
  });
});

describe('a kind’s default', () => {
  it('is stored, and storing the same again is nothing', () => {
    expect(setKindDefaultOps(DOC, 'tent', TENT_350)).toEqual([{ type: 'setKindDefault', kind: 'tent', size: TENT_350 }]);
    expect(setKindDefaultOps({ ...DOC, defaults: { tent: TENT_350 } }, 'tent', { ...TENT_350 })).toEqual([]);
    expect(setKindDefaultOps(DOC, 'tent', null)).toEqual([]);
  });

  it('never lets a non-net kind’s default carry an inset, even a whole one', () => {
    expect(setKindDefaultOps(DOC, 'tent', { widthCm: 300, depthCm: 300, heightCm: 200, insetCm: 40 })).toEqual([
      { type: 'setKindDefault', kind: 'tent', size: { widthCm: 300, depthCm: 300, heightCm: 200, insetCm: null } },
    ]);
  });
});

describe('arranging several items', () => {
  // The box around t1 (100,100 300 × 300) and c1 (100,600 700 × 250) runs x 100–800, y 100–850.
  it('aligns on each edge and middle of the box around them', () => {
    expect(alignOps(DOC, ['t1', 'c1'], 'east')).toEqual([{ type: 'update', id: 't1', patch: { xCm: 500 } }]);
    expect(alignOps(DOC, ['t1', 'c1'], 'centreX')).toEqual([{ type: 'update', id: 't1', patch: { xCm: 300 } }]);
    expect(alignOps(DOC, ['t1', 'c1'], 'west')).toEqual([]);
    expect(alignOps(DOC, ['t1', 'c1'], 'north')).toEqual([{ type: 'update', id: 'c1', patch: { yCm: 100 } }]);
    expect(alignOps(DOC, ['t1', 'c1'], 'south')).toEqual([{ type: 'update', id: 't1', patch: { yCm: 550 } }]);
    expect(alignOps(DOC, ['t1', 'c1'], 'centreY')).toEqual([
      { type: 'update', id: 't1', patch: { yCm: 325 } },
      { type: 'update', id: 'c1', patch: { yCm: 350 } },
    ]);
  });

  it('needs two unlocked items to align', () => {
    expect(alignOps(DOC, ['t1', 'lk'], 'east')).toEqual([]);
  });

  it('spaces three items evenly, keeping the first and the last', () => {
    // t1 ends at 400, f1 starts at 2000, t2 is 300 wide: (2000 - 400 - 300) / 2 = 650 each side.
    expect(distributeOps(DOC, ['t1', 't2', 'f1'], 'x')).toEqual([{ type: 'update', id: 't2', patch: { xCm: 1050 } }]);
    // By middles t1 (250), f1 (335), c1 (725): (600 - 400 - 70) / 2 = 65.
    expect(distributeOps(DOC, ['t1', 'c1', 'f1'], 'y')).toEqual([{ type: 'update', id: 'f1', patch: { yCm: 465 } }]);
  });

  it('needs three unlocked items to distribute', () => {
    expect(distributeOps(DOC, ['t1', 't2', 'lk'], 'x')).toEqual([]);
  });

  it('lays a row west to east from the box’s corner, in the order they stand', () => {
    // t1 stays at (100,100); c1 goes to 100 + 300 + 50; t2 to 450 + 700 + 50.
    expect(rowOps(DOC, ['t2', 't1', 'c1'], 50)).toEqual([
      { type: 'update', id: 'c1', patch: { xCm: 450, yCm: 100 } },
      { type: 'update', id: 't2', patch: { xCm: 1200 } },
    ]);
  });
});

describe('every command undoes back to the start', () => {
  // An odd-sided item (91 × 90), so the turn case's centre-pivot arithmetic is exercised on a
  // pair of sides that split unevenly, not just DOC's even ones.
  const OD = make({ id: 'od', label: 'אוהל 7', xCm: 50, yCm: 50, widthCm: 91, depthCm: 90, sort: 6 });
  const DOC_ODD: EditorDoc = { ...DOC, items: [...DOC.items, OD] };

  const cases: Array<[string, EditorDoc, SiteOp[]]> = [
    ['move', DOC, moveOps(DOC, ['t1', 't2', 'c1'], 50, -50)],
    ['set a rectangle', DOC, setRectOps(DOC, 'c1', { xCm: 150, yCm: 650, widthCm: 650, depthCm: 300 })],
    ['turn', DOC_ODD, turnOps(DOC_ODD, ['c1', 'f1', 'od'])],
    ['add', DOC, addOps(DOC, 'shade', { xCm: 0, yCm: 1500 }, 'n1')],
    ['remove', DOC, removeOps(DOC, ['t2', 'c1'])],
    ['duplicate', DOC, duplicateOps(DOC, ['t1', 't2'], ids('n1', 'n2')).ops],
    ['lock', DOC, lockOps(DOC, ['t1', 'lk'], true)],
    ['patch', DOC, patchOps(DOC, 's1', { kind: 'sofa', label: 'ספה גדולה' })],
    ['resize a kind', DOC, resizeKindOps(DOC, ['t1', 't2'], 'tent', { widthCm: 350, heightCm: 180 })],
    ['reset sizes', DOC, resetSizeOps(DOC, ['c1'])],
    ['set a kind default', DOC, setKindDefaultOps(DOC, 'tent', TENT_350)],
    ['align', DOC, alignOps(DOC, ['t1', 'c1'], 'centreY')],
    ['distribute', DOC, distributeOps(DOC, ['t1', 't2', 'f1'], 'x')],
    ['row', DOC, rowOps(DOC, ['t2', 't1', 'c1'], 50)],
  ];

  it.each(cases)('%s', (_name, doc, ops) => {
    expect(ops.length).toBeGreaterThan(0);
    const after = applyOps(doc, ops);
    expect(after.skipped).toEqual([]);
    expect(after.doc).not.toEqual(doc);
    expect(applyOps(after.doc, invertOps(doc, ops)).doc).toStrictEqual(doc);
  });
});

describe('every fractional input becomes a whole centimetre, never -0', () => {
  function assertWhole(value: unknown): void {
    if (typeof value !== 'number') return;
    expect(Number.isInteger(value)).toBe(true);
    expect(Object.is(value, -0)).toBe(false);
  }

  function assertWholeOps(ops: readonly SiteOp[]): void {
    for (const op of ops) {
      if (op.type === 'add') {
        for (const value of Object.values(op.item)) assertWhole(value);
      } else if (op.type === 'update') {
        for (const value of Object.values(op.patch)) assertWhole(value);
      } else if (op.type === 'setKindDefault' && op.size !== null) {
        for (const value of Object.values(op.size)) assertWhole(value);
      }
    }
  }

  it('rounds every command’s numbers, including the -0 plain rounding would give', () => {
    // A tent at x=1, width 10: resizing to width 13 pivots the centre by -0.5 — plain
    // Math.round gives -0 here, which is exactly the bug this fix closes.
    const tiny = make({ id: 'ti', label: 'אוהל 9', xCm: 1, yCm: 1, widthCm: 10, depthCm: 10 });
    // An item spanning x -1..1 inside a two-item box of width 3: centring it pivots by -0.5 too.
    const edge = make({ id: 'eg', label: 'אוהל 10', xCm: -1, yCm: 0, widthCm: 2, depthCm: 300 });
    const rest = make({ id: 'rt', label: 'אוהל 11', xCm: 1, yCm: 0, widthCm: 1, depthCm: 300 });
    const doc: EditorDoc = { ...DOC, items: [...DOC.items, tiny, edge, rest] };

    assertWholeOps(moveOps(doc, ['t1', 't2'], 12.6, -12.6));
    assertWholeOps(setRectOps(doc, 't1', { xCm: 612.6, yCm: 100.4, widthCm: 350.4, depthCm: 300.2 }));
    assertWholeOps(turnOps(doc, ['c1']));
    assertWholeOps(addOps(doc, 'shade', { xCm: 612.6, yCm: 100.4 }, 'n1'));
    assertWholeOps(duplicateOps(doc, ['f1'], ids('n2')).ops);
    assertWholeOps(patchOps(doc, 't1', { xCm: 612.6, widthCm: 350.4, heightCm: 180.6 }));
    assertWholeOps(patchOps(doc, 't1', { kind: 'shade', insetCm: 62.4 }));
    assertWholeOps(resizeKindOps(doc, ['ti'], 'tent', { widthCm: 13 }));
    assertWholeOps(resizeKindOps(doc, ['t1'], 'tent', { widthCm: 350.4, depthCm: 300.2, heightCm: 210.6 }));
    assertWholeOps(resetSizeOps(doc, ['t1']));
    assertWholeOps(setKindDefaultOps(doc, 'tent', { widthCm: 350.4, depthCm: 300.2, heightCm: 210.6, insetCm: null }));
    assertWholeOps(setKindDefaultOps(doc, 'shade', { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 18.5 }));
    assertWholeOps(alignOps(doc, ['eg', 'rt'], 'centreX'));
    assertWholeOps(distributeOps(doc, ['t1', 't2', 'f1'], 'x'));
    assertWholeOps(rowOps(doc, ['t2', 't1', 'c1'], 12.6));
  });
});
