import { describe, it, expect } from 'vitest';
import type { EditorDoc, EditorItem } from './model';
import { applyOps, invertOps } from './ops';
import { splitOps } from './commands';
import { lineTotals, unconnected } from '../lines';

/**
 * A split (`splitOps`): one run from the tank to a new splitter and one from
 * the splitter to each target, the splitter standing where the runs add up
 * shortest and on free ground.
 */

function item(over: Partial<EditorItem> & { id: string; kind: EditorItem['kind'] }): EditorItem {
  return {
    label: over.id, xCm: 0, yCm: 0, widthCm: 100, depthCm: 100, heightCm: null, insetCm: null,
    sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

/* A tank at the origin, two showers ten metres east at y 0 and y 1000, a sink between them, a toilet. */
const TANK = item({ id: 'tank', kind: 'water' });
const S1 = item({ id: 's1', kind: 'shower', xCm: 1000, yCm: 0 });
const S2 = item({ id: 's2', kind: 'shower', xCm: 1000, yCm: 1000 });
const SINK = item({ id: 'sink', kind: 'sink', xCm: 1000, yCm: 500, widthCm: 150, depthCm: 60 });
const TOILET = item({ id: 'toilet', kind: 'toilet', xCm: 500, yCm: 1500 });

const DOC: EditorDoc = {
  plot: { id: 'p', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 },
  items: [TANK, S1, S2, SINK, TOILET], lines: [], defaults: {},
};
const IDS = { splitter: 'sp', lines: ['l0', 'l1', 'l2', 'l3'] };

describe('a split', () => {
  it('adds a splitter and a run from the tank to it, then one to each target, in that order', () => {
    const { ops, splitterId } = splitOps(DOC, 'water', 'tank', ['s1', 's2', 'sink'], IDS);
    expect(splitterId).toBe('sp');
    expect(ops.map((op) => op.type)).toEqual(['add', 'addLine', 'addLine', 'addLine', 'addLine']);
    const after = applyOps(DOC, ops).doc;
    const splitter = after.items.find((entry) => entry.id === 'sp');
    expect(splitter).toMatchObject({ kind: 'splitter', label: 'מפצל 1', widthCm: 30, depthCm: 30 });
    expect(after.lines.map((line) => [line.fromId, line.toId])).toEqual([['tank', 'sp'], ['sp', 's1'], ['sp', 's2'], ['sp', 'sink']]);
    expect(after.lines.map((line) => line.label)).toEqual(['צינור מים 1', 'צינור מים 2', 'צינור מים 3', 'צינור מים 4']);
    // Every target is now reached from the tank through the splitter.
    expect(unconnected(after, 'water')).toEqual([]);
  });

  it('stands the splitter where the runs add up shortest — between the tank and the targets, on the grid', () => {
    const { ops } = splitOps(DOC, 'water', 'tank', ['s1', 's2', 'sink'], IDS);
    const after = applyOps(DOC, ops).doc;
    const splitter = after.items.find((entry) => entry.id === 'sp')!;
    // The median of (50,50), (1050,50), (1050,1050), (1075,530) sits east of centre; its NW corner lands on a 50 cm grid line.
    expect(splitter.xCm % 50).toBe(0);
    expect(splitter.yCm % 50).toBe(0);
    // Three of the four points stand at x ≈ 1050, so the median does too; the free cell beside the sink takes it.
    expect(splitter.xCm).toBeGreaterThan(600);
    expect(splitter.xCm).toBeLessThan(1200);
    expect(splitter.yCm).toBeGreaterThan(200);
    expect(splitter.yCm).toBeLessThan(800);
    // Shorter than three direct runs would have been.
    const direct = ['s1', 's2', 'sink'].reduce((sum, id) => {
      const doc = applyOps(DOC, [{ type: 'addLine', line: { id, kind: 'water', label: id, fromId: 'tank', toId: id, points: [], sort: 0, notes: null } }]).doc;
      return sum + lineTotals(doc).water.lengthCm;
    }, 0);
    expect(lineTotals(after).water.lengthCm).toBeLessThan(direct);
  });

  it('is one undoable step: apply then undo is the starting doc', () => {
    const { ops } = splitOps(DOC, 'water', 'tank', ['s1', 's2'], IDS);
    const after = applyOps(DOC, ops).doc;
    const back = applyOps(after, invertOps(DOC, ops)).doc;
    expect(back.items).toEqual(DOC.items);
    expect(back.lines).toEqual([]);
  });

  it('does nothing for one target, a target the utility does not reach, a repeated target, a source that cannot split, or too few ids', () => {
    const none = { ops: [], splitterId: null };
    expect(splitOps(DOC, 'water', 'tank', ['s1'], IDS)).toEqual(none);
    expect(splitOps(DOC, 'water', 'tank', ['s1', 'toilet'], IDS)).toEqual(none);
    expect(splitOps(DOC, 'water', 'tank', ['s1', 's1'], IDS)).toEqual(none);
    expect(splitOps(DOC, 'water', 's1', ['s2', 'sink'], IDS)).toEqual(none);
    expect(splitOps(DOC, 'power', 'tank', ['s1', 's2'], IDS)).toEqual(none);
    expect(splitOps(DOC, 'water', 'tank', ['s1', 's2', 'sink'], { splitter: 'sp', lines: ['a', 'b'] })).toEqual(none);
  });

  it('splits again from a splitter, and skips a target already joined to it', () => {
    const first = applyOps(DOC, splitOps(DOC, 'water', 'tank', ['s1', 's2'], IDS).ops).doc;
    // From the splitter: the sink is free, s1 is already joined to it.
    expect(splitOps(first, 'water', 'sp', ['s1', 'sink'], { splitter: 'sp2', lines: ['m0', 'm1', 'm2'] }).splitterId).toBeNull();
    const more = { ...first, items: [...first.items, item({ id: 's3', kind: 'shower', xCm: 1500, yCm: 500 })] };
    const { ops, splitterId } = splitOps(more, 'water', 'sp', ['sink', 's3'], { splitter: 'sp2', lines: ['m0', 'm1', 'm2'] });
    expect(splitterId).toBe('sp2');
    expect(applyOps(more, ops).doc.items.find((entry) => entry.id === 'sp2')?.label).toBe('מפצל 2');
  });
});
