import { describe, it, expect } from 'vitest';
import { imageToMap, quarterTurn } from '../underlay';
import { underlayOf, type EditorDoc, type EditorUnderlay } from './model';
import { applyOps, invertOps } from './ops';
import { calibrateOps, placeOps, removeUnderlayOps, uploadOps, type UploadedUnderlay } from './underlay-commands';

const PLAN = '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a';
const FILE_A: UploadedUnderlay = {
  storageKey: `site-underlays/${PLAN}/${'a'.repeat(64)}.png`, contentType: 'image/png', sizeBytes: 812_345, filename: 'שרטוט.png',
};
const FILE_B: UploadedUnderlay = {
  storageKey: `site-underlays/${PLAN}/${'b'.repeat(64)}.jpg`, contentType: 'image/jpeg', sizeBytes: 1_234_567, filename: 'IMG_2231.jpg',
};

function docOf(underlay: EditorUnderlay | null = null): EditorDoc {
  return { plot: { id: PLAN, widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items: [], lines: [], defaults: {}, underlay };
}

/** Where a calibrated, straightened picture lies. */
const PLACED: EditorUnderlay = {
  ...FILE_A, centreXCm: 1000, centreYCm: 900, widthCm: 3000, rotationTenths: 37,
  calibration: { from: [0.1, 0.5], to: [0.9, 0.5], distanceCm: 2600 },
};

describe('a picture uploaded to the map', () => {
  it('lies centred on the plot and as wide as it, unturned and uncalibrated (§18.2)', () => {
    expect(uploadOps(docOf(), FILE_A)).toEqual([{
      type: 'setUnderlay',
      underlay: { ...FILE_A, centreXCm: 1300, centreYCm: 1200, widthCm: 2600, rotationTenths: 0, calibration: null },
    }]);
  });

  it('replaces the old one where it lay — its middle and width — and starts the turn and the calibration over (§18.7)', () => {
    expect(uploadOps(docOf(PLACED), FILE_B)).toEqual([{
      type: 'setUnderlay',
      underlay: { ...FILE_B, centreXCm: 1000, centreYCm: 900, widthCm: 3000, rotationTenths: 0, calibration: null },
    }]);
  });

  it('changes nothing when the same file comes again', () => {
    expect(uploadOps(docOf(PLACED), FILE_A)).toEqual([]);
  });
});

describe('moving, turning, calibrating and removing it', () => {
  it('moves or turns it as one op, and does nothing without a picture, without a change, or for a refused move', () => {
    const turned = quarterTurn(PLACED, 1);
    expect(placeOps(docOf(PLACED), turned)).toEqual([{ type: 'setUnderlay', underlay: { ...PLACED, rotationTenths: 937 } }]);
    expect(placeOps(docOf(PLACED), { centreXCm: 1000, centreYCm: 900, widthCm: 3000, rotationTenths: 37 })).toEqual([]);
    expect(placeOps(docOf(PLACED), null)).toEqual([]);
    expect(placeOps(docOf(), turned)).toEqual([]);
  });

  it('calibrates as one op that keeps the two points and the distance (§18.3)', () => {
    const doc = docOf({ ...PLACED, rotationTenths: 0, calibration: null });
    const ops = calibrateOps(doc, 0.75, [0.1, 0.5], [0.9, 0.5], 2600, false);
    expect(ops).toHaveLength(1);
    const next = underlayOf(applyOps(doc, ops!).doc)!;
    expect(next.calibration).toEqual({ from: [0.1, 0.5], to: [0.9, 0.5], distanceCm: 2600 });
    const a = imageToMap(next, 0.75, [0.1, 0.5]);
    const b = imageToMap(next, 0.75, [0.9, 0.5]);
    expect(Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]))).toBe(2600);
  });

  it('answers null for a distance that makes the scale absurd, and nothing without a picture', () => {
    expect(calibrateOps(docOf(PLACED), 0.75, [0.5, 0.5], [0.51, 0.5], 50_000, false)).toBeNull();
    expect(calibrateOps(docOf(), 0.75, [0.1, 0.5], [0.9, 0.5], 2600, false)).toEqual([]);
  });

  it('takes it off the map, and does nothing when there is none', () => {
    expect(removeUnderlayOps(docOf(PLACED))).toEqual([{ type: 'setUnderlay', underlay: null }]);
    expect(removeUnderlayOps(docOf())).toEqual([]);
  });

  it('comes back exactly after each command and its inverse', () => {
    const start = docOf(PLACED);
    for (const ops of [
      uploadOps(start, FILE_B),
      placeOps(start, quarterTurn(PLACED, -1)),
      calibrateOps(start, 0.75, [0.2, 0.2], [0.8, 0.6], 1800, true)!,
      removeUnderlayOps(start),
    ]) {
      expect(ops.length).toBeGreaterThan(0);
      const after = applyOps(start, ops).doc;
      expect(underlayOf(applyOps(after, invertOps(start, ops)).doc)).toEqual(PLACED);
    }
  });
});
