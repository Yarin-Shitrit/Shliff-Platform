import { describe, it, expect } from 'vitest';
import { snapMove, snapResize, type SnapInput } from './snapping';

const PLOT = { widthCm: 2600, depthCm: 2400 };
const TENT = { x: 100, y: 100, width: 300, depth: 300 };

function input(over: Partial<SnapInput>): SnapInput {
  return { moving: TENT, others: [], plot: PLOT, dxCm: 0, dyCm: 0, gridCm: 50, thresholdCm: 20, free: false, ...over };
}

describe('snapping a move', () => {
  it('moves freely, in whole centimetres, with Alt', () => {
    expect(snapMove(input({ dxCm: 33.4, dyCm: -12.6, free: true }))).toEqual({ dxCm: 33, dyCm: -13, guides: [] });
  });

  it('snaps to the grid when no line is near', () => {
    // 100 + 237 = 337 → 350 on a 50 cm grid; nothing within 20 cm of 350, 500 or 650.
    const others = [{ x: 1010, y: 800, width: 200, depth: 100 }];
    expect(snapMove(input({ others, dxCm: 237 }))).toEqual({ dxCm: 250, dyCm: 0, guides: [] });
  });

  it('then takes a neighbour’s edge within the threshold, and draws the guide', () => {
    // 100 + 590 = 690 → 700 on the grid; the east edge (1000) is 10 cm from the neighbour's west edge (1010).
    const others = [{ x: 1010, y: 800, width: 200, depth: 100 }];
    expect(snapMove(input({ others, dxCm: 590 }))).toEqual({
      dxCm: 610,
      dyCm: 0,
      guides: [{ from: [1010, 40], to: [1010, 960] }],
    });
  });

  it('takes the nearest line when two are in reach', () => {
    // East edge at 1000: one neighbour's edge 12 cm on, the other's 7 cm back. The nearer wins.
    const others = [{ x: 1012, y: 800, width: 200, depth: 100 }, { x: 993, y: 1500, width: 100, depth: 100 }];
    expect(snapMove(input({ others, dxCm: 590 }))).toEqual({
      dxCm: 593,
      dyCm: 0,
      guides: [{ from: [993, 40], to: [993, 1660] }],
    });
  });

  it('lines a middle up with the plot’s middle', () => {
    // A 290 cm box at 1150 has its middle at 1295, 5 cm from the plot's middle (1300).
    const moving = { x: 100, y: 100, width: 290, depth: 300 };
    expect(snapMove(input({ moving, dxCm: 1045 }))).toEqual({
      dxCm: 1055,
      dyCm: 0,
      guides: [{ from: [1300, -60], to: [1300, 2460] }],
    });
  });
});

describe('snapping a resize', () => {
  it('snaps the dragged edge and keeps the opposite one', () => {
    expect(snapResize(TENT, 'e', 37, 0, 50, false)).toEqual({ x: 100, y: 100, width: 350, depth: 300 });
    expect(snapResize(TENT, 'e', 37, 0, 50, true)).toEqual({ x: 100, y: 100, width: 337, depth: 300 });
  });

  it('never goes under ten centimetres', () => {
    expect(snapResize(TENT, 'nw', 500, 0, 50, false)).toEqual({ x: 390, y: 100, width: 10, depth: 300 });
  });
});

describe('snapping on a four-sided plot', () => {
  const CAMP = { widthCm: 3500, depthCm: 2498, sides: { northCm: 3300, southCm: 3500, westCm: 2500, eastCm: 2500 } };

  it('offers no column for a leaning side: the box’s west edge is one point of the fence', () => {
    const moving = { x: 100, y: 1000, width: 300, depth: 300 };
    // 100 − 90 = 10 → 0 on the grid, and no line at x = 0 to take or to draw.
    expect(snapMove(input({ plot: CAMP, moving, dxCm: -90 }))).toEqual({ dxCm: -100, dyCm: 0, guides: [] });
    // On the box alone the same drag takes the west edge and draws it.
    expect(snapMove(input({ plot: { widthCm: 3500, depthCm: 2498 }, moving, dxCm: -90 })).guides).toHaveLength(1);
  });

  it('offers the rows where the fence runs, and the guide spans the fence’s row', () => {
    const moving = { x: 1000, y: 100, width: 300, depth: 300 };
    // 100 − 85 = 15 → 0 on the grid, which is the north row: it runs from x = 100 to 3400.
    expect(snapMove(input({ plot: CAMP, moving, dyCm: -85 }))).toEqual({
      dxCm: 0, dyCm: -100, guides: [{ from: [40, 0], to: [3460, 0] }],
    });
  });
});
