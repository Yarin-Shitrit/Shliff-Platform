import { describe, it, expect } from 'vitest';
import type { EditorDoc, EditorItem, EditorLine } from './editor/model';
import { nextLineLabel } from './editor/model';
import {
  anchorOf, eligibleEnds, endpointRefusal, joins, lineKindsOf, lineLengthCm, linePath, lineTotals, pathLengthCm,
  unconnected,
} from './lines';

function item(over: Partial<EditorItem> & Pick<EditorItem, 'id' | 'kind'>): EditorItem {
  return {
    label: over.id, xCm: 0, yCm: 0, widthCm: 100, depthCm: 100, heightCm: null, insetCm: null, ropeAngleDeg: null,
    sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

function line(over: Partial<EditorLine> & Pick<EditorLine, 'id' | 'kind' | 'fromId' | 'toId'>): EditorLine {
  return { label: over.id, points: [], sort: 0, notes: null, ...over };
}

/*
 * Graph paper, centimetres, x east and y south:
 *   tank   a 1 × 1 m drinking-water tank at (0, 0)
 *   shower a 1 × 1 m shower at (500, 0)        — five metres east of the tank
 *   sink   a 1 × 0.5 m sink at (500, 300)
 *   toilet a 1 × 1 m toilet at (300, 300)
 *   gen    the generator at (0, 1000)
 *   fridge a fridge at (1000, 1000)
 *   light1, light2 two lights at (1000, 1300) and (1000, 1600)
 */
const TANK = item({ id: 'tank', kind: 'water' });
const SHOWER = item({ id: 'shower', kind: 'shower', xCm: 500 });
const SINK = item({ id: 'sink', kind: 'sink', xCm: 500, yCm: 300, depthCm: 50 });
const TOILET = item({ id: 'toilet', kind: 'toilet', xCm: 300, yCm: 300 });
const GEN = item({ id: 'gen', kind: 'generator', yCm: 1000 });
const FRIDGE = item({ id: 'fridge', kind: 'fridge', xCm: 1000, yCm: 1000 });
const LIGHT1 = item({ id: 'light1', kind: 'light', xCm: 1000, yCm: 1300 });
const LIGHT2 = item({ id: 'light2', kind: 'light', xCm: 1000, yCm: 1600 });

function doc(lines: EditorLine[] = []): EditorDoc {
  return {
    plot: { id: 'p', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 },
    items: [TANK, SHOWER, SINK, TOILET, GEN, FRIDGE, LIGHT1, LIGHT2],
    lines,
    defaults: {},
  };
}

describe('what a line may join', () => {
  it('runs water to a shower or a sink and never to a toilet', () => {
    expect(joins('water', 'water')).toBe(true);
    expect(joins('water', 'shower')).toBe(true);
    expect(joins('water', 'sink')).toBe(true);
    expect(joins('water', 'toilet')).toBe(false);
    expect(joins('water', 'fridge')).toBe(false);
  });

  it('runs power to a fridge or a light and never to a shower', () => {
    expect(joins('power', 'generator')).toBe(true);
    expect(joins('power', 'fridge')).toBe(true);
    expect(joins('power', 'light')).toBe(true);
    expect(joins('power', 'shower')).toBe(false);
  });

  it('says which utilities an item takes part in', () => {
    expect(lineKindsOf('shower')).toEqual(['water']);
    expect(lineKindsOf('light')).toEqual(['power']);
    expect(lineKindsOf('tent')).toEqual([]);
  });

  it('refuses the wrong end in the words failure-messages.ts keys on', () => {
    expect(endpointRefusal('water', 'water', 'shower', false)).toBeNull();
    // Two takers never join each other: water comes from a tank (or a splitter fed by one).
    expect(endpointRefusal('water', 'shower', 'sink', false)).toMatch(/^a water pipe runs from/);
    expect(endpointRefusal('power', 'light', 'fridge', false)).toMatch(/^a power cable runs from/);
    expect(endpointRefusal('water', 'splitter', 'sink', false)).toBeNull();
    expect(endpointRefusal('water', 'water', 'toilet', false)).toMatch(/^a water pipe joins only/);
    expect(endpointRefusal('power', 'generator', 'shower', false)).toMatch(/^a power cable joins only/);
    expect(endpointRefusal('power', 'generator', 'generator', true)).toMatch(/^a line must join two different items/);
  });
});

describe('where a line leaves an item', () => {
  const rect = { x: 0, y: 0, width: 100, depth: 100 };

  it('is the point on the outline toward the other end', () => {
    expect(anchorOf(rect, [500, 50])).toEqual([100, 50]);
    expect(anchorOf(rect, [50, 900])).toEqual([50, 100]);
    expect(anchorOf(rect, [-300, 50])).toEqual([0, 50]);
    // A diagonal leaves through the corner region of the nearer side.
    expect(anchorOf(rect, [300, 150])).toEqual([100, 70]);
  });

  it('is the middle when the other end is inside the item', () => {
    expect(anchorOf(rect, [50, 50])).toEqual([50, 50]);
    expect(anchorOf(rect, [80, 20])).toEqual([50, 50]);
  });
});

describe('how long a line is', () => {
  it('measures wall to wall, straight', () => {
    // Tank (0..100) to shower (500..600): from x=100 to x=500 at y=50.
    const path = linePath([], { x: 0, y: 0, width: 100, depth: 100 }, { x: 500, y: 0, width: 100, depth: 100 });
    expect(path).toEqual([[100, 50], [500, 50]]);
    expect(pathLengthCm(path)).toBe(400);
  });

  it('runs through the bends, and the ends aim at the nearest bend', () => {
    const path = linePath([[50, 300], [550, 300]], { x: 0, y: 0, width: 100, depth: 100 }, { x: 500, y: 0, width: 100, depth: 100 });
    expect(path).toEqual([[50, 100], [50, 300], [550, 300], [550, 100]]);
    expect(pathLengthCm(path)).toBe(200 + 500 + 200);
  });

  it('rounds once, at the end', () => {
    // 3-4-5 twice: two legs of 50 cm each along a diagonal are 70.71 + 70.71 = 141.42 → 141, not 71 + 71.
    expect(pathLengthCm([[0, 0], [50, 50], [100, 100]])).toBe(141);
  });

  it('is null when an end is not on the map', () => {
    const map = doc([line({ id: 'w1', kind: 'water', fromId: 'tank', toId: 'gone' })]);
    expect(lineLengthCm(map, map.lines[0])).toBeNull();
  });
});

describe('the totals, per utility', () => {
  it('add up every line whose ends are both on the map', () => {
    const map = doc([
      line({ id: 'w1', kind: 'water', fromId: 'tank', toId: 'shower' }),
      line({ id: 'w2', kind: 'water', fromId: 'shower', toId: 'sink' }),
      line({ id: 'p1', kind: 'power', fromId: 'gen', toId: 'fridge' }),
      line({ id: 'p2', kind: 'power', fromId: 'gen', toId: 'gone' }),
    ]);
    const totals = lineTotals(map);
    // w1: 400. w2: shower bottom (550, 100) to sink top (550, 300): 200.
    expect(totals.water).toEqual({ kind: 'water', ids: ['w1', 'w2'], lengthCm: 600 });
    // p1: generator east wall (100, 1050) to fridge west wall (1000, 1050): 900.
    expect(totals.power).toEqual({ kind: 'power', ids: ['p1'], lengthCm: 900 });
  });

  it('are zero for a map with no lines', () => {
    expect(lineTotals(doc()).water).toEqual({ kind: 'water', ids: [], lengthCm: 0 });
  });
});

describe('what is not yet reached from a source', () => {
  it('names every consumer with no lines', () => {
    expect(unconnected(doc(), 'water')).toEqual(['shower', 'sink']);
    expect(unconnected(doc(), 'power')).toEqual(['fridge', 'light1', 'light2']);
  });

  it('follows a chain from the source, and a chain that never meets one', () => {
    const map = doc([
      line({ id: 'p1', kind: 'power', fromId: 'gen', toId: 'fridge' }),
      line({ id: 'p2', kind: 'power', fromId: 'light2', toId: 'light1' }), // two lights joined to each other only
    ]);
    expect(unconnected(map, 'power')).toEqual(['light1', 'light2']);
    const reached = doc([...map.lines, line({ id: 'p3', kind: 'power', fromId: 'fridge', toId: 'light1' })]);
    expect(unconnected(reached, 'power')).toEqual([]);
  });

  it('does not let a water pipe count as power', () => {
    const map = doc([line({ id: 'w1', kind: 'water', fromId: 'tank', toId: 'shower' })]);
    expect(unconnected(map, 'water')).toEqual(['sink']);
    expect(unconnected(map, 'power')).toEqual(['fridge', 'light1', 'light2']);
  });
});

describe('what a new line may run to', () => {
  it('offers every other item that carries the utility, not yet joined to this one', () => {
    const map = doc([line({ id: 'w1', kind: 'water', fromId: 'tank', toId: 'shower' })]);
    expect(eligibleEnds(map, 'tank', 'water').map((entry) => entry.id)).toEqual(['sink']);
    // From a shower only a giver is offered — and the tank is already joined to it.
    expect(eligibleEnds(map, 'shower', 'water').map((entry) => entry.id)).toEqual([]);
    expect(eligibleEnds(map, 'sink', 'water').map((entry) => entry.id)).toEqual(['tank']);
    expect(eligibleEnds(map, 'gen', 'power').map((entry) => entry.id)).toEqual(['fridge', 'light1', 'light2']);
    expect(eligibleEnds(map, 'toilet', 'water')).toEqual([]);
  });
});

describe('a new line’s name', () => {
  it('is one past the highest number of its kind', () => {
    expect(nextLineLabel([], 'water')).toBe('צינור מים 1');
    expect(nextLineLabel([line({ id: 'a', kind: 'water', fromId: 'x', toId: 'y', label: 'צינור מים 3' })], 'water')).toBe('צינור מים 4');
    expect(nextLineLabel([line({ id: 'a', kind: 'water', fromId: 'x', toId: 'y', label: 'צינור מים 3' })], 'power')).toBe('כבל חשמל 1');
  });
});
