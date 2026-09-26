import { describe, it, expect } from 'vitest';
import { fitPrint, printSpots, type PrintSpot } from './prints';

const one = (spots: PrintSpot[], face: PrintSpot['face']): PrintSpot => {
  const found = spots.filter((spot) => spot.face === face);
  expect(found).toHaveLength(1);
  return found[0];
};

/** A spot's rectangle on its face, along the reading axis and across it — top faces only, where both axes lie on the map. */
function topRect(spot: PrintSpot): { x0: number; x1: number; y0: number; y1: number } {
  const [alongX, across] = spot.readFrom === 'south' ? [spot.widthCm, spot.heightCm] : [spot.heightCm, spot.widthCm];
  return { x0: spot.xCm - alongX / 2, x1: spot.xCm + alongX / 2, y0: spot.yCm - across / 2, y1: spot.yCm + across / 2 };
}

describe('where a name is printed, by shape', () => {
  it('prints a caravan on its top, reading from the south, and on its long south wall', () => {
    const spots = printSpots('box', 700, 250, 270, 0, null);
    expect(spots.map((spot) => spot.face)).toEqual(['top', 'wallSouth']);
    expect(one(spots, 'top')).toMatchObject({ xCm: 350, yCm: 125, zCm: 270, widthCm: 700, heightCm: 250, tiltDeg: 0, readFrom: 'south', fracW: 0.86, fracH: 0.7 });
    expect(one(spots, 'wallSouth')).toMatchObject({ xCm: 350, yCm: 250, zCm: 135, widthCm: 700, heightCm: 270, tiltDeg: 90, readFrom: 'south', fracW: 0.84, fracH: 0.5 });
  });

  it('turns the caravan’s top print to read along the long side from the west, and moves the wall print to the west wall', () => {
    const spots = printSpots('box', 250, 700, 270, 1, null);
    expect(one(spots, 'top')).toMatchObject({ xCm: 125, yCm: 350, zCm: 270, widthCm: 700, heightCm: 250, readFrom: 'west' });
    expect(one(spots, 'wallWest')).toMatchObject({ xCm: 0, yCm: 350, zCm: 135, widthCm: 700, heightCm: 270, tiltDeg: 90, readFrom: 'west' });
  });

  it('prints a shower on its top and its south wall, a table on its top only', () => {
    expect(printSpots('box', 100, 100, 210, 0, null).map((spot) => spot.face)).toEqual(['top', 'wallSouth']);
    expect(printSpots('box', 180, 80, 75, 0, null).map((spot) => spot.face)).toEqual(['top']);
    // A box whose depth is under one and a half times its width still reads from the south.
    expect(one(printSpots('box', 100, 140, 100, 0, null), 'top').readFrom).toBe('south');
  });

  it('prints a tent on its south roof slope, centred on the slope and tilted with it', () => {
    const [roof] = printSpots('tent', 300, 300, 200, 0, null);
    expect(roof).toMatchObject({ face: 'roofSouth', xCm: 150, yCm: 225, zCm: 150, widthCm: 300, readFrom: 'south', fracW: 0.8, fracH: 0.78 });
    expect(roof.heightCm).toBe(Math.round(Math.hypot(150, 100)));
    expect(roof.tiltDeg).toBeCloseTo(33.69, 2);
  });

  it('moves the tent’s print to the west slope when the ridge turns north–south — by size, or by a square tent’s facing', () => {
    const [bySize] = printSpots('tent', 200, 300, 200, 0, null);
    expect(bySize).toMatchObject({ face: 'roofWest', xCm: 50, yCm: 150, zCm: 150, widthCm: 300, readFrom: 'west' });
    expect(bySize.heightCm).toBe(Math.round(Math.hypot(100, 100)));
    expect(bySize.tiltDeg).toBeCloseTo(45, 6);

    expect(printSpots('tent', 300, 300, 200, 1, null)[0].face).toBe('roofWest');
    expect(printSpots('tent', 300, 300, 200, 2, null)[0].face).toBe('roofSouth');
    expect(printSpots('tent', 300, 300, 200, 3, null)[0].face).toBe('roofWest');
  });

  it('keeps the seat print off the back for every facing', () => {
    for (const facing of [0, 1, 2, 3]) {
      const spots = printSpots('sofa', 200, 90, 80, facing, null);
      const seat = one(spots, 'seat');
      expect(seat.zCm).toBe(40);
      expect(seat.readFrom).toBe('south');
      // The back's slab, by the same rule the builder uses: north at 0, then east, south, west.
      const thick = Math.max(15, (facing % 2 === 0 ? 90 : 200) * 0.26);
      const slab = facing === 0 ? { x0: 0, x1: 200, y0: 0, y1: thick }
        : facing === 1 ? { x0: 200 - thick, x1: 200, y0: 0, y1: 90 }
          : facing === 2 ? { x0: 0, x1: 200, y0: 90 - thick, y1: 90 }
            : { x0: 0, x1: thick, y0: 0, y1: 90 };
      // The print itself, as fitted (a wide name), never reaches the slab.
      const fitted = fitPrint(seat, 4);
      const print = {
        x0: seat.xCm - fitted.widthCm / 2, x1: seat.xCm + fitted.widthCm / 2,
        y0: seat.yCm - fitted.heightCm / 2, y1: seat.yCm + fitted.heightCm / 2,
      };
      const apart = print.x1 <= slab.x0 || print.x0 >= slab.x1 || print.y1 <= slab.y0 || print.y0 >= slab.y1;
      expect(apart, `facing ${facing}`).toBe(true);
      // And the spot stays inside the seat.
      const rect = topRect(seat);
      expect(rect.x0).toBeGreaterThanOrEqual(-1);
      expect(rect.x1).toBeLessThanOrEqual(201);
      expect(rect.y0).toBeGreaterThanOrEqual(-1);
      expect(rect.y1).toBeLessThanOrEqual(91);
    }
  });

  it('prints a tank and a fire on the cap', () => {
    expect(printSpots('cylinder', 120, 120, 130, 0, null)).toEqual([
      { face: 'cap', xCm: 60, yCm: 60, zCm: 130, widthCm: 120, heightCm: 120, fracW: 0.72, fracH: 0.5, tiltDeg: 0, readFrom: 'south' },
    ]);
    expect(printSpots('fire', 150, 150, 35, 0, null)[0]).toMatchObject({ face: 'cap', zCm: 35 });
  });

  it('prints a net on a band a metre inside its north edge, on the cloth', () => {
    expect(printSpots('net', 800, 800, 300, 0, 50)).toEqual([
      { face: 'cloth', xCm: 400, yCm: 100, zCm: 300, widthCm: 800, heightCm: 800, fracW: 0.4, fracH: 0.2, tiltDeg: 0, readFrom: 'south' },
    ]);
    // A small net's band is a quarter of the way in, so it stays on the cloth.
    expect(printSpots('net', 300, 200, 250, 0, null)[0].yCm).toBe(50);
  });

  it('answers in whole centimetres', () => {
    for (const spot of printSpots('sofa', 201, 91, 81, 0, null)) {
      for (const key of ['xCm', 'yCm', 'zCm', 'widthCm', 'heightCm'] as const) expect(Number.isInteger(spot[key]), key).toBe(true);
    }
  });
});

describe('fitting the print to its spot', () => {
  it('fills the allowed width when the name is wide, keeping its proportions', () => {
    const top = one(printSpots('box', 700, 250, 270, 0, null), 'top');
    // 86% of 700 is 602; a 4:1 name is 151 tall — under 70% of 250.
    expect(fitPrint(top, 4)).toEqual({ widthCm: 602, heightCm: 151 });
  });

  it('is held by the allowed height when the name is short', () => {
    const wall = one(printSpots('box', 100, 100, 210, 0, null), 'wallSouth');
    // 84% of 100 is 84, and 3 × (50% of 210) is 315: the width wins.
    expect(fitPrint(wall, 3)).toEqual({ widthCm: 84, heightCm: 28 });
    // A square name on the same wall: 50% of 210 is 105, which beats the 84 the width allows.
    expect(fitPrint(wall, 1)).toEqual({ widthCm: 84, heightCm: 84 });
    // A very tall name: the height rules.
    expect(fitPrint(wall, 0.5)).toEqual({ widthCm: 53, heightCm: 106 });
  });

  it('prints nothing for a texture with no size', () => {
    const cap = printSpots('cylinder', 100, 100, 100, 0, null)[0];
    expect(fitPrint(cap, 0)).toEqual({ widthCm: 0, heightCm: 0 });
  });
});
