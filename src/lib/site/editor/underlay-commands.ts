import { calibrate, initialPlacement, type ImagePoint, type UnderlayPlacement } from '../underlay';
import type { UnderlayContentType } from '../underlay-limits';
import { sameUnderlay, underlayOf, type EditorDoc, type EditorUnderlay } from './model';
import type { SiteOp } from './ops';

/**
 * Every edit of the picture under the map as ops (spec §18), with the rule
 * `commands.ts` keeps: pure, and `[]` when nothing would change, so a no-op
 * is never recorded in history or sent. Each user action is one op, so one
 * undo step: an upload, a calibration, a drag, a nudge, a quarter turn, a
 * removal.
 */

/** What the upload route answered (spec §16): the file as stored, not yet on the map. */
export interface UploadedUnderlay {
  storageKey: string;
  contentType: UnderlayContentType;
  sizeBytes: number;
  filename: string;
}

function setTo(doc: EditorDoc, next: EditorUnderlay | null): SiteOp[] {
  return sameUnderlay(underlayOf(doc), next) ? [] : [{ type: 'setUnderlay', underlay: next }];
}

/**
 * A picture just uploaded, on the map. The first lies centred on the plot and
 * as wide as it, unturned and uncalibrated (§18.2). A replacement keeps where
 * the old one lay — its middle and its width — and starts over on the rest:
 * the calibration belonged to the old picture (§18.7), and so did any turn
 * that straightened it. The same file again changes nothing.
 */
export function uploadOps(doc: EditorDoc, file: UploadedUnderlay): SiteOp[] {
  const current = underlayOf(doc);
  if (current !== null && current.storageKey === file.storageKey) return [];
  const placement: UnderlayPlacement = current === null
    ? initialPlacement(doc.plot)
    : { centreXCm: current.centreXCm, centreYCm: current.centreYCm, widthCm: current.widthCm, rotationTenths: 0 };
  return setTo(doc, { ...file, ...placement, calibration: null });
}

/** The picture moved or turned (§18.4). `null` is a move `moveBy` refused. */
export function placeOps(doc: EditorDoc, placement: UnderlayPlacement | null): SiteOp[] {
  const current = underlayOf(doc);
  if (current === null || placement === null) return [];
  return setTo(doc, { ...current, ...placement });
}

/**
 * Calibration, as one op that keeps the two points and the distance, so the
 * card can say what it was calibrated from (§18.3). Null when the typed
 * distance puts the scale out of range (`calibrate`); `[]` with no picture.
 */
export function calibrateOps(
  doc: EditorDoc, aspect: number, from: ImagePoint, to: ImagePoint, distanceCm: number, parallel: boolean,
): SiteOp[] | null {
  const current = underlayOf(doc);
  if (current === null) return [];
  const placement = calibrate(current, aspect, from, to, distanceCm, parallel);
  if (placement === null) return null;
  return setTo(doc, {
    ...current,
    ...placement,
    calibration: { from: [from[0], from[1]], to: [to[0], to[1]], distanceCm },
  });
}

/** Off the map (§18.8). The file stays in storage, so an undo can bring it back (§16). */
export function removeUnderlayOps(doc: EditorDoc): SiteOp[] {
  return underlayOf(doc) === null ? [] : [{ type: 'setUnderlay', underlay: null }];
}
