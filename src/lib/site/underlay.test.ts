import { describe, it, expect } from 'vitest';
import { displaySize } from './image-facts';
import {
  calibrate, coverSize, imageToMap, initialPlacement, isOnImage, mapToImage, moveBy, normaliseTenths, quarterTurn,
  type ImagePoint, type MapPoint, type UnderlayPlacement,
} from './underlay';

const ASPECT = 0.75;
/** Centred on a 26 × 24 m plot, as wide as it: 26 × 19.5 m, unturned. */
const P: UnderlayPlacement = { centreXCm: 1300, centreYCm: 1200, widthCm: 2600, rotationTenths: 0 };

const distance = (a: MapPoint, b: MapPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('a point on the picture and a point on the map', () => {
  it('puts the picture’s top-left at the north-west when unturned — never mirrored', () => {
    // Half the width (1300) west of the middle, half the depth (975) north of it.
    expect(imageToMap(P, ASPECT, [0, 0])).toEqual([0, 225]);
    expect(imageToMap(P, ASPECT, [1, 0])).toEqual([2600, 225]);
    expect(imageToMap(P, ASPECT, [1, 1])).toEqual([2600, 2175]);
    expect(imageToMap(P, ASPECT, [0.5, 0.5])).toEqual([1300, 1200]);
  });

  it('turns clockwise seen from above: a quarter turn brings the top-left corner to the north-east', () => {
    // (-1300, -975) turned 90° clockwise, with y pointing south, is (975, -1300).
    const [x, y] = imageToMap({ ...P, rotationTenths: 900 }, ASPECT, [0, 0]);
    expect(x).toBeCloseTo(2275, 6);
    expect(y).toBeCloseTo(-100, 6);
  });

  it('round-trips map → picture → map and picture → map → picture, however it is turned', () => {
    for (const placement of [P, { ...P, rotationTenths: 1234 }, { centreXCm: -400, centreYCm: 3100, widthCm: 777, rotationTenths: 3599 }]) {
      for (const point of [[0, 0], [0.13, 0.87], [1, 1], [0.5, 0.25]] as ImagePoint[]) {
        const back = mapToImage(placement, ASPECT, imageToMap(placement, ASPECT, point));
        expect(back[0]).toBeCloseTo(point[0], 9);
        expect(back[1]).toBeCloseTo(point[1], 9);
      }
      const ground: MapPoint = [1000, 800];
      const again = imageToMap(placement, ASPECT, mapToImage(placement, ASPECT, ground));
      expect(distance(again, ground)).toBeLessThan(1e-6);
    }
  });

  it('knows a point on the picture from one beside it, edges included', () => {
    expect(isOnImage([0, 0])).toBe(true);
    expect(isOnImage([1, 1])).toBe(true);
    expect(isOnImage([0.5, 0.5])).toBe(true);
    expect(isOnImage([-0.001, 0.5])).toBe(false);
    expect(isOnImage([0.5, 1.0001])).toBe(false);
    expect(isOnImage([Number.NaN, 0.5])).toBe(false);
  });
});

describe('where a new picture lies, and what it covers', () => {
  it('lies centred on the plot and as wide as it, unturned', () => {
    expect(initialPlacement({ widthCm: 2600, depthCm: 2400 })).toEqual(P);
    expect(initialPlacement({ widthCm: 2601, depthCm: 2401 })).toEqual({ centreXCm: 1301, centreYCm: 1201, widthCm: 2601, rotationTenths: 0 });
  });

  it('covers its width by the width times its aspect', () => {
    expect(coverSize(P, ASPECT)).toEqual({ widthCm: 2600, depthCm: 1950 });
    expect(coverSize({ ...P, widthCm: 3120 }, 2760 / 3120)).toEqual({ widthCm: 3120, depthCm: 2760 });
  });
});

describe('moving and turning it', () => {
  it('moves by whole centimetres, and not past half a kilometre', () => {
    expect(moveBy(P, 10.4, -100)).toEqual({ ...P, centreXCm: 1310, centreYCm: 1100 });
    expect(moveBy(P, 60_000, 0)).toBeNull();
    expect(moveBy(P, 0, -60_000)).toBeNull();
  });

  it('turns a quarter about its own middle, both ways, and comes round after four', () => {
    const right = quarterTurn(P, 1);
    expect(right).toEqual({ ...P, rotationTenths: 900 });
    expect(imageToMap(right, ASPECT, [0.5, 0.5])).toEqual([1300, 1200]);
    expect(quarterTurn(P, -1).rotationTenths).toBe(2700);
    expect(quarterTurn({ ...P, rotationTenths: 3500 }, 1).rotationTenths).toBe(800);
    expect(quarterTurn(quarterTurn(quarterTurn(quarterTurn(P, 1), 1), 1), 1)).toEqual(P);
  });

  it('keeps a turn inside one circle, in whole tenths', () => {
    expect(normaliseTenths(3600)).toBe(0);
    expect(normaliseTenths(-1)).toBe(3599);
    expect(normaliseTenths(7237.4)).toBe(37);
  });
});

describe('calibration', () => {
  it('scales about A, so A stays where it is and AB becomes the typed length', () => {
    // A (0.1, 0.5) is at x 260 and B (0.9, 0.5) at x 2340: 20.8 m apart. Typed 26 m, so the width grows by 26 / 20.8
    // to 3250, and the middle moves so A stays at x 260: 260 + 0.4 × 3250 = 1560.
    const next = calibrate(P, ASPECT, [0.1, 0.5], [0.9, 0.5], 2600, false);
    expect(next).toEqual({ centreXCm: 1560, centreYCm: 1200, widthCm: 3250, rotationTenths: 0 });
    expect(imageToMap(next!, ASPECT, [0.1, 0.5])).toEqual([260, 1200]);
    expect(distance(imageToMap(next!, ASPECT, [0.1, 0.5]), imageToMap(next!, ASPECT, [0.9, 0.5]))).toBe(2600);
  });

  it('keeps A within a centimetre, and AB within a centimetre of the length, for a turned picture and a skewed pair', () => {
    const turned = { ...P, rotationTenths: 125 };
    const from: ImagePoint = [0.2, 0.3];
    const to: ImagePoint = [0.85, 0.62];
    const next = calibrate(turned, ASPECT, from, to, 2600, false);
    expect(next).not.toBeNull();
    expect(next!.rotationTenths).toBe(125);
    const a = imageToMap(next!, ASPECT, from);
    expect(distance(a, imageToMap(turned, ASPECT, from))).toBeLessThanOrEqual(1);
    expect(Math.abs(distance(a, imageToMap(next!, ASPECT, to)) - 2600)).toBeLessThanOrEqual(1);
  });

  it('straightens the picture with the parallel box: AB then lies along the nearer map axis, turned about A', () => {
    // A line drawn a little crooked on a slightly turned photo: after the box, it runs east-west.
    const skewed = { ...P, rotationTenths: 37 };
    const from: ImagePoint = [0.1, 0.2];
    const to: ImagePoint = [0.9, 0.25];
    const next = calibrate(skewed, ASPECT, from, to, 2600, true)!;
    const a = imageToMap(next, ASPECT, from);
    const b = imageToMap(next, ASPECT, to);
    expect(distance(a, imageToMap(skewed, ASPECT, from))).toBeLessThanOrEqual(1);
    // A turn is kept in tenths of a degree: across 26 m that is at most 2.3 cm off the axis.
    expect(Math.abs(b[1] - a[1])).toBeLessThanOrEqual(3);
    expect(next.rotationTenths).not.toBe(37);
    // A nearly north-south line straightens to the other axis.
    const upright = calibrate(P, ASPECT, [0.5, 0.1], [0.53, 0.9], 1500, true)!;
    const top = imageToMap(upright, ASPECT, [0.5, 0.1]);
    const bottom = imageToMap(upright, ASPECT, [0.53, 0.9]);
    expect(Math.abs(bottom[0] - top[0])).toBeLessThanOrEqual(3);
  });

  it('calibrates a phone photo on the picture as shown, after its EXIF turn (Review Focus #1)', () => {
    // Stored 4032 × 3024 with orientation 6 — shown upright, 3024 × 4032.
    const shown = displaySize({ kind: 'jpeg', width: 4032, height: 3024, orientation: 6 })!;
    const aspect = shown.height / shown.width;
    expect(aspect).toBeCloseTo(4 / 3, 9);
    // The fence's long side marked top to bottom on the upright photo, typed as 24 m.
    const next = calibrate(P, aspect, [0.5, 0.1], [0.5, 0.9], 2400, false)!;
    const a = imageToMap(next, aspect, [0.5, 0.1]);
    const b = imageToMap(next, aspect, [0.5, 0.9]);
    expect(Math.abs(distance(a, b) - 2400)).toBeLessThanOrEqual(1);
    // Read with the stored (landscape) aspect instead, the same two clicks would be 24 m of a different picture.
    const wrong = calibrate(P, 0.75, [0.5, 0.1], [0.5, 0.9], 2400, false)!;
    expect(wrong.widthCm).not.toBe(next.widthCm);
  });

  it('refuses a scale the typed distance makes absurd, and two points that are one', () => {
    // 26 cm of picture typed as 500 m makes it 5 km wide.
    expect(calibrate(P, ASPECT, [0.5, 0.5], [0.51, 0.5], 50_000, false)).toBeNull();
    // Corner to corner typed as 10 cm makes it 8 cm wide.
    expect(calibrate(P, ASPECT, [0, 0], [1, 1], 10, false)).toBeNull();
    expect(calibrate(P, ASPECT, [0.3, 0.3], [0.3, 0.3], 2600, false)).toBeNull();
  });
});
