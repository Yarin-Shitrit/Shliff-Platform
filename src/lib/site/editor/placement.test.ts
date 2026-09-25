import { describe, it, expect } from 'vitest';
import type { EditorDoc, EditorItem } from './model';
import { nearestFreeSpot } from './placement';

function make(over: Partial<EditorItem> & Pick<EditorItem, 'id'>): EditorItem {
  return {
    kind: 'tent', label: 'אוהל', xCm: 0, yCm: 0, widthCm: 300, depthCm: 300, heightCm: null, insetCm: null,
    sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

function docOf(items: EditorItem[], plot = { widthCm: 2600, depthCm: 2400 }): EditorDoc {
  return { plot: { id: 'p', ...plot, gridCm: 50, northDeg: 0 }, items, lines: [], defaults: {} };
}

const TENT = { widthCm: 300, depthCm: 300 };
const MIDDLE = { xCm: 1300, yCm: 1200 };

describe('the free spot nearest a point', () => {
  it('centres the item on the point when the ground is free', () => {
    expect(nearestFreeSpot(docOf([]), 'tent', TENT, MIDDLE)).toEqual({ xCm: 1150, yCm: 1050 });
  });

  it('steps off an item standing there, north first when the sides are equally near', () => {
    // West, east, north and south are all 3 m away; north is found first.
    const doc = docOf([make({ id: 't1', xCm: 1150, yCm: 1050 })]);
    expect(nearestFreeSpot(doc, 'tent', TENT, MIDDLE)).toEqual({ xCm: 1150, yCm: 750 });
  });

  it('puts a tent under a net, and a net over a tent', () => {
    const net = make({ id: 's1', kind: 'shade', xCm: 900, yCm: 800, widthCm: 800, depthCm: 800, insetCm: 50 });
    expect(nearestFreeSpot(docOf([net]), 'tent', TENT, MIDDLE)).toEqual({ xCm: 1150, yCm: 1050 });
    const tent = make({ id: 't1', xCm: 1150, yCm: 1050 });
    expect(nearestFreeSpot(docOf([tent]), 'shade', { widthCm: 800, depthCm: 800 }, MIDDLE)).toEqual({ xCm: 900, yCm: 800 });
  });

  it('keeps the item inside the fence when the point is outside it', () => {
    expect(nearestFreeSpot(docOf([]), 'tent', TENT, { xCm: -500, yCm: 3000 })).toEqual({ xCm: 0, yCm: 2100 });
  });

  it('answers null when nothing fits', () => {
    expect(nearestFreeSpot(docOf([], { widthCm: 200, depthCm: 200 }), 'tent', TENT, MIDDLE)).toBeNull();
    const full = docOf([make({ id: 't1' })], { widthCm: 300, depthCm: 300 });
    expect(nearestFreeSpot(full, 'tent', TENT, MIDDLE)).toBeNull();
  });
});
