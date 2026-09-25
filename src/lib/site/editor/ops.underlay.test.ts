import { describe, it, expect } from 'vitest';
import { underlayOf, type EditorDoc, type EditorItem, type EditorUnderlay } from './model';
import { applyOps, coalesceOps, invertOps, opRefusal, underlayRefusal, type SiteOp } from './ops';

const PLAN = '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a';
const KEY_A = `site-underlays/${PLAN}/${'a'.repeat(64)}.png`;
const KEY_B = `site-underlays/${PLAN}/${'b'.repeat(64)}.jpg`;

/** This file's own fixture: a 26 × 24 m plot and one tent. */
const TENT: EditorItem = {
  id: 't1', kind: 'tent', label: 'אוהל 1', xCm: 500, yCm: 500, widthCm: 300, depthCm: 300,
  heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ropeAngleDeg: null,
};

function docOf(underlay?: EditorUnderlay | null): EditorDoc {
  const doc: EditorDoc = { plot: { id: PLAN, widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items: [TENT], lines: [], defaults: {} };
  return underlay === undefined ? doc : { ...doc, underlay };
}

function image(over: Partial<EditorUnderlay> = {}): EditorUnderlay {
  return {
    storageKey: KEY_A, contentType: 'image/png', sizeBytes: 812_345, filename: 'שרטוט.png',
    centreXCm: 1300, centreYCm: 1200, widthCm: 2600, rotationTenths: 0, calibration: null, ...over,
  };
}

const set = (underlay: EditorUnderlay | null): SiteOp => ({ type: 'setUnderlay', underlay });

describe('the image’s refusals', () => {
  it('passes a well-formed image, and none', () => {
    expect(underlayRefusal(image())).toBeNull();
    expect(underlayRefusal(image({ calibration: { from: [0, 0.25], to: [1, 0.5], distanceCm: 2600 } }))).toBeNull();
    expect(underlayRefusal(null)).toBeNull();
    expect(opRefusal(set(null))).toBeNull();
  });

  it('refuses a file that is not a picture uploaded to a map', () => {
    const file = 'an underlay file must be a png, jpeg or webp image uploaded to a map';
    expect(underlayRefusal(image({ storageKey: `uploads/${'a'.repeat(64)}.xlsx` }))).toBe(file);
    expect(underlayRefusal(image({ storageKey: `site-underlays/../${'a'.repeat(64)}.png` }))).toBe(file);
    expect(underlayRefusal(image({ contentType: 'image/jpeg' }))).toBe(file);
    expect(underlayRefusal(image({ storageKey: KEY_B, contentType: 'image/png' }))).toBe(file);
    expect(underlayRefusal(image({ sizeBytes: 0 }))).toBe(file);
    expect(underlayRefusal(image({ sizeBytes: 4 * 1024 * 1024 + 1 }))).toBe(file);
    expect(underlayRefusal(image({ sizeBytes: 1.5 }))).toBe(file);
    expect(underlayRefusal(image({ filename: '  ' }))).toBe(file);
    expect(opRefusal(set(image({ filename: '‏' })))).toBe(file);
    // Read back from outside the editor, an op may carry no picture at all, or not an object.
    expect(opRefusal({ type: 'setUnderlay' } as unknown as SiteOp)).toBe(file);
    expect(opRefusal({ type: 'setUnderlay', underlay: 'x' } as unknown as SiteOp)).toBe(file);
  });

  it('refuses a placement in fractions, too small, too far or turned past a circle', () => {
    const placement = 'an underlay placement must be whole centimetres and tenths of a degree';
    expect(underlayRefusal(image({ centreXCm: 12.5 }))).toBe(placement);
    expect(underlayRefusal(image({ centreYCm: 50_001 }))).toBe(placement);
    expect(underlayRefusal(image({ centreXCm: -50_001 }))).toBe(placement);
    expect(underlayRefusal(image({ widthCm: 9 }))).toBe(placement);
    expect(underlayRefusal(image({ widthCm: 50_001 }))).toBe(placement);
    expect(underlayRefusal(image({ rotationTenths: 3600 }))).toBe(placement);
    expect(underlayRefusal(image({ rotationTenths: -1 }))).toBe(placement);
    expect(underlayRefusal(image({ rotationTenths: 12.5 }))).toBe(placement);
    expect(underlayRefusal(image({ centreXCm: -50_000, centreYCm: 50_000, widthCm: 10, rotationTenths: 3599 }))).toBeNull();
  });

  it('refuses a calibration off the picture, of no length, or not in whole centimetres', () => {
    const calibration = 'an underlay calibration must be two points on the image and a distance of 10 cm to 500 m';
    expect(underlayRefusal(image({ calibration: { from: [1.2, 0], to: [0.5, 0.5], distanceCm: 2600 } }))).toBe(calibration);
    expect(underlayRefusal(image({ calibration: { from: [0.1, Number.NaN], to: [0.5, 0.5], distanceCm: 2600 } }))).toBe(calibration);
    expect(underlayRefusal(image({ calibration: { from: [0.1, 0.1], to: [0.5, 0.5], distanceCm: 5 } }))).toBe(calibration);
    expect(underlayRefusal(image({ calibration: { from: [0.1, 0.1], to: [0.5, 0.5], distanceCm: 2600.5 } }))).toBe(calibration);
    expect(underlayRefusal(image({ calibration: { from: [0.1, 0.1], to: [0.5, 0.5], distanceCm: 50_001 } }))).toBe(calibration);
  });
});

describe('applying, undoing and batching the image', () => {
  it('reads a doc written before the image existed as having none', () => {
    expect(underlayOf(docOf())).toBeNull();
    expect(underlayOf(docOf(null))).toBeNull();
    expect(underlayOf(docOf(image()))).toEqual(image());
  });

  it('puts the image on the map and takes it off, and leaves the items as they were', () => {
    const before = docOf();
    const placed = applyOps(before, [set(image())]);
    expect(placed.skipped).toEqual([]);
    expect(underlayOf(placed.doc)).toEqual(image());
    expect(placed.doc.items).toBe(before.items);
    expect(underlayOf(applyOps(placed.doc, [set(null)]).doc)).toBeNull();
  });

  it('gives back the very same doc when no op touches the image or anything else', () => {
    const doc = docOf(image());
    expect(applyOps(doc, []).doc).toBe(doc);
    expect(applyOps(doc, [{ type: 'update', id: 't1', patch: { xCm: 600 } }]).doc.underlay).toBe(doc.underlay);
  });

  it('keeps its own copy: changing the op afterwards changes nothing on the map', () => {
    const op = set(image({ calibration: { from: [0.1, 0.5], to: [0.9, 0.5], distanceCm: 2600 } }));
    const doc = applyOps(docOf(), [op]).doc;
    (op as { underlay: EditorUnderlay }).underlay.calibration!.from[0] = 0.7;
    (op as { underlay: EditorUnderlay }).underlay.centreXCm = 9;
    expect(underlayOf(doc)?.calibration?.from[0]).toBe(0.1);
    expect(underlayOf(doc)?.centreXCm).toBe(1300);
  });

  it('undoes to what was there — none, or the image before — and records nothing for a change to the same', () => {
    const none = docOf();
    expect(invertOps(none, [set(image())])).toEqual([set(null)]);
    const old = docOf(image({ rotationTenths: 900 }));
    const inverse = invertOps(old, [set(image({ storageKey: KEY_B, contentType: 'image/jpeg' }))]);
    expect(inverse).toEqual([set(image({ rotationTenths: 900 }))]);
    expect(invertOps(old, [set(image({ rotationTenths: 900 }))])).toEqual([]);
    expect(invertOps(none, [set(null)])).toEqual([]);
  });

  it('comes back exactly after an op and its inverse', () => {
    for (const [start, op] of [
      [docOf(), set(image())],
      [docOf(image()), set(null)],
      [docOf(image()), set(image({ centreXCm: 1500, rotationTenths: 37 }))],
    ] as Array<[EditorDoc, SiteOp]>) {
      const after = applyOps(start, [op]).doc;
      const back = applyOps(after, invertOps(start, [op])).doc;
      expect(underlayOf(back)).toEqual(underlayOf(start));
    }
  });

  it('sends only the last image of a batch, in the first one’s place', () => {
    const move: SiteOp = { type: 'update', id: 't1', patch: { xCm: 600 } };
    expect(coalesceOps([set(image()), move, set(image({ centreXCm: 1400 })), set(null)])).toEqual([set(null), move]);
    expect(coalesceOps([move, set(image({ widthCm: 3000 }))])).toEqual([move, set(image({ widthCm: 3000 }))]);
  });
});
