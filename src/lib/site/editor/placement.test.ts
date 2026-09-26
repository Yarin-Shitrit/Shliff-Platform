import { describe, it, expect } from 'vitest';
import type { EditorDoc, EditorItem } from './model';
import { landingRule, nearestFreeSpot } from './placement';

function make(over: Partial<EditorItem> & Pick<EditorItem, 'id'>): EditorItem {
  return {
    kind: 'tent', label: 'אוהל', xCm: 0, yCm: 0, widthCm: 300, depthCm: 300, heightCm: null, insetCm: null, ropeAngleDeg: null,
    sort: 0, taskId: null, notes: null, facing: 0, locked: false, ...over,
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

describe('landing clear of a net’s ropes', () => {
  const CAMP_45 = { shade: { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 } };
  const roped = (doc: EditorDoc): EditorDoc => ({ ...doc, defaults: CAMP_45 });
  // Cloth 9–17 m east, 8–16 m south; with 3 m ropes, footprint 6–20 m east, 5–19 m south.
  const NET = make({ id: 's1', kind: 'shade', xCm: 900, yCm: 800, widthCm: 800, depthCm: 800, insetCm: 50 });
  const TENT_KIND = { kind: 'tent' as const, heightCm: null, ropeAngleDeg: null };

  it('puts a new net where its ropes stay inside the fence', () => {
    const corner = { xCm: 0, yCm: 0 };
    expect(nearestFreeSpot(docOf([]), 'shade', { widthCm: 800, depthCm: 800 }, corner)).toEqual({ xCm: 0, yCm: 0 });
    expect(nearestFreeSpot(roped(docOf([])), 'shade', { widthCm: 800, depthCm: 800 }, corner)).toEqual({ xCm: 300, yCm: 300 });
  });

  it('keeps a new tent out of a net’s rope band, stepping out rather than under when out is nearer', () => {
    const near = { xCm: 650, yCm: 1200 };
    expect(nearestFreeSpot(docOf([NET]), 'tent', TENT, near)).toEqual({ xCm: 500, yCm: 1050 });
    expect(nearestFreeSpot(roped(docOf([NET])), 'tent', TENT, near)).toEqual({ xCm: 300, yCm: 1050 });
  });

  it('says why a spot is refused', () => {
    const lands = landingRule(roped(docOf([NET, make({ id: 't1', xCm: 2000, yCm: 100 })])));
    const at = (x: number, y: number) => ({ x, y, width: 300, depth: 300 });
    expect(lands(TENT_KIND, at(1100, 1000))).toBe('ok'); // under the cloth
    expect(lands(TENT_KIND, at(500, 1000))).toBe('ropes'); // in the west band
    expect(lands(TENT_KIND, at(2100, 100))).toBe('overlapping'); // on the other tent
    expect(lands(TENT_KIND, at(2400, 100))).toBe('outside');
    const net = { x: 100, y: 100, width: 800, depth: 800 };
    expect(lands({ kind: 'shade', heightCm: null, ropeAngleDeg: null }, net)).toBe('outside'); // its own 3 m ropes cross
    expect(lands({ kind: 'shade', heightCm: 100, ropeAngleDeg: null }, net)).toBe('ok'); // 1 m high: ropes 1 m, flush
  });
});
