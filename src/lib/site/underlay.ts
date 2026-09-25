import { MAX_UNDERLAY_OFFSET_CM, MAX_UNDERLAY_WIDTH_CM, MIN_UNDERLAY_WIDTH_CM } from './underlay-limits';

/**
 * Where the picture under the map lies (spec §17–18), and the two ways of
 * naming a point on it: as a fraction of the picture, or as a place on the
 * map. Pure: no `three`, no React, no DOM.
 *
 * The placement stores the map length of the picture's width. Its depth
 * follows from the picture's own proportions, `aspect` (height ÷ width of the
 * picture as shown, after any EXIF turn), which only the decoded image knows,
 * so every function that needs it is handed it. The turn is clockwise seen
 * from above, in tenths of a degree, about the picture's middle. At 0 the
 * picture's top edge faces north and its left edge west: never mirrored,
 * whatever the page's direction.
 *
 * Calibration points are fractions of the picture as shown (0–1), so they
 * hold whatever size the browser decodes it at (spec §17).
 */

/** u, v: fractions of the displayed picture's width and height, from its top-left corner. */
export type ImagePoint = [number, number];
/** x, y: map centimetres, x east and y south; fractional until something is stored. */
export type MapPoint = [number, number];

export interface UnderlayPlacement {
  /** Where the picture's middle sits on the map. */
  centreXCm: number;
  centreYCm: number;
  /** The map length of the picture's width, as displayed. */
  widthCm: number;
  /** Clockwise seen from above, tenths of a degree, 0–3599. */
  rotationTenths: number;
}

/** Two points marked on the picture, and the distance a lead typed between them (spec §17). */
export interface UnderlayCalibration {
  from: ImagePoint;
  to: ImagePoint;
  distanceCm: number;
}

const FULL_TURN_TENTHS = 3600;
const QUARTER_TURN_TENTHS = 900;

function radians(tenths: number): number {
  return (tenths / 10) * (Math.PI / 180);
}

/** Turned clockwise on the map, which, with y pointing south, is clockwise seen from above. */
function turn([x, y]: MapPoint, angle: number): MapPoint {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos - y * sin, x * sin + y * cos];
}

/** A picture point's offset from the middle, before the turn. */
function offsetOf(placement: UnderlayPlacement, aspect: number, [u, v]: ImagePoint): MapPoint {
  return [(u - 0.5) * placement.widthCm, (v - 0.5) * placement.widthCm * aspect];
}

/** Whole tenths, 0–3599. */
export function normaliseTenths(tenths: number): number {
  return ((Math.round(tenths) % FULL_TURN_TENTHS) + FULL_TURN_TENTHS) % FULL_TURN_TENTHS;
}

export function imageToMap(placement: UnderlayPlacement, aspect: number, point: ImagePoint): MapPoint {
  const [dx, dy] = turn(offsetOf(placement, aspect, point), radians(placement.rotationTenths));
  return [placement.centreXCm + dx, placement.centreYCm + dy];
}

export function mapToImage(placement: UnderlayPlacement, aspect: number, [x, y]: MapPoint): ImagePoint {
  const [dx, dy] = turn([x - placement.centreXCm, y - placement.centreYCm], -radians(placement.rotationTenths));
  return [dx / placement.widthCm + 0.5, dy / (placement.widthCm * aspect) + 0.5];
}

/** On the picture, its edges included. */
export function isOnImage([u, v]: ImagePoint): boolean {
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}

/** A new picture before calibration: centred on the plot and as wide as it. A way to see it, not a scale (spec §18.2). */
export function initialPlacement(plot: { widthCm: number; depthCm: number }): UnderlayPlacement {
  return {
    centreXCm: Math.round(plot.widthCm / 2),
    centreYCm: Math.round(plot.depthCm / 2),
    widthCm: plot.widthCm,
    rotationTenths: 0,
  };
}

/** How much of the map the picture covers: "מכסה על המפה 31.2 × 27.6 מ׳" (spec §18). */
export function coverSize(placement: UnderlayPlacement, aspect: number): { widthCm: number; depthCm: number } {
  return { widthCm: placement.widthCm, depthCm: Math.round(placement.widthCm * aspect) };
}

function inBounds(placement: UnderlayPlacement): boolean {
  return Math.abs(placement.centreXCm) <= MAX_UNDERLAY_OFFSET_CM
    && Math.abs(placement.centreYCm) <= MAX_UNDERLAY_OFFSET_CM
    && placement.widthCm >= MIN_UNDERLAY_WIDTH_CM
    && placement.widthCm <= MAX_UNDERLAY_WIDTH_CM;
}

/** Moved by whole centimetres (spec §18.4). Null when that would take its middle past half a kilometre. */
export function moveBy(placement: UnderlayPlacement, dxCm: number, dyCm: number): UnderlayPlacement | null {
  const next = {
    ...placement,
    centreXCm: placement.centreXCm + Math.round(dxCm),
    centreYCm: placement.centreYCm + Math.round(dyCm),
  };
  return inBounds(next) ? next : null;
}

/** A quarter turn about the picture's middle (spec §18.4): 1 is to the right (clockwise), −1 to the left. */
export function quarterTurn(placement: UnderlayPlacement, direction: 1 | -1): UnderlayPlacement {
  return { ...placement, rotationTenths: normaliseTenths(placement.rotationTenths + direction * QUARTER_TURN_TENTHS) };
}

/**
 * Calibration (spec §18.3). A and B are two points on the picture, and the
 * lead typed the distance between them. The picture is scaled about A, so A
 * stays where it is on the map and AB on the map is that distance. With
 * `parallel` ("הקו הזה מקביל לגדר") it is also turned about A until AB lies
 * along the nearer map axis. That is how a photographed sketch is
 * straightened from the same two clicks, with no rotation dial.
 *
 * The width is kept in whole centimetres and the turn in tenths of a degree.
 * The middle is then placed from A under the rounded width and turn, so the
 * rounding never walks A away: A moves by at most the middle's own rounding,
 * under a centimetre.
 *
 * Null when A and B are one point on the map, or when the result would be
 * narrower than 10 cm, wider than 500 m, or have its middle past half a
 * kilometre. Then it is the typed distance, not the map, that is wrong.
 */
export function calibrate(
  placement: UnderlayPlacement, aspect: number, from: ImagePoint, to: ImagePoint, distanceCm: number, parallel: boolean,
): UnderlayPlacement | null {
  const a = imageToMap(placement, aspect, from);
  const b = imageToMap(placement, aspect, to);
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(length > 0) || !(distanceCm > 0)) return null;

  const widthCm = Math.round((placement.widthCm * distanceCm) / length);
  let rotationTenths = placement.rotationTenths;
  if (parallel) {
    // AB's direction on the map, in the same clockwise-positive degrees as the turn.
    const angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    rotationTenths = normaliseTenths(placement.rotationTenths + (Math.round(angle / 90) * 90 - angle) * 10);
  }

  const [dx, dy] = turn(offsetOf({ ...placement, widthCm }, aspect, from), radians(rotationTenths));
  const next = { centreXCm: Math.round(a[0] - dx), centreYCm: Math.round(a[1] - dy), widthCm, rotationTenths };
  return inBounds(next) ? next : null;
}
