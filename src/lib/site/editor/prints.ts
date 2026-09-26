import type { SiteKindShape } from '@/lib/site/kinds';

/**
 * Where an item's name is printed on it (plan 2026-09-26-site-label-modes,
 * D3 and D4): the face, the rectangle on it, and which way it reads. Pure
 * geometry in the map's centimetres — x east, y south, z up, from the item's
 * north-west ground corner — with no `three` in it. The scene adapter
 * (`scene/prints.ts`) turns each spot into a decal.
 *
 * The map never mirrors for right-to-left, and neither does a print: a
 * top-face print has its top edge north and reads from the south; a west
 * wall's reads from the west.
 */
export type PrintFace = 'top' | 'cap' | 'seat' | 'cloth' | 'roofSouth' | 'roofWest' | 'wallSouth' | 'wallWest';

export interface PrintSpot {
  face: PrintFace;
  /** Centre of the printable rectangle, map cm from the item's north-west ground corner (x east, y south, z up). */
  xCm: number;
  yCm: number;
  zCm: number;
  /** The rectangle's extent along the reading direction and across it, cm; the print is fitted inside `fracW × fracH` of it. */
  widthCm: number;
  heightCm: number;
  fracW: number;
  fracH: number;
  /** Tilt of the face from horizontal, degrees, toward the reader: 0 for a top, 90 for a wall, the roof's pitch for a slope. */
  tiltDeg: number;
  /** Where a reader stands to read it upright: south of it (text top to the north / up the slope / up the wall) or west of it. */
  readFrom: 'south' | 'west';
}

/** How much of each face a print may cover (D4): along the reading direction, then across it. */
const FIT: Record<PrintFace, [number, number]> = {
  top: [0.86, 0.7],
  seat: [0.86, 0.7],
  cap: [0.72, 0.5],
  cloth: [0.4, 0.2],
  roofSouth: [0.8, 0.78],
  roofWest: [0.8, 0.78],
  wallSouth: [0.84, 0.5],
  wallWest: [0.84, 0.5],
};

/** A solid at least this tall also carries its name on a wall: a caravan, a shower, the kitchen — not a table or a bar. */
const WALL_FROM_CM = 150;
/** A net's print sits in a band this far inside its north edge, never over the lounge under it (spec §9.1). */
const CLOTH_BAND_CM = 100;
/** A top whose depth is this many times its width reads along the long side, from the west. */
const LONG_TOP = 1.5;

function spot(
  face: PrintFace, xCm: number, yCm: number, zCm: number, widthCm: number, heightCm: number, tiltDeg: number, readFrom: 'south' | 'west',
): PrintSpot {
  const [fracW, fracH] = FIT[face];
  return {
    face,
    xCm: Math.round(xCm), yCm: Math.round(yCm), zCm: Math.round(zCm),
    widthCm: Math.round(widthCm), heightCm: Math.round(heightCm),
    fracW, fracH, tiltDeg, readFrom,
  };
}

const degrees = (radians: number): number => (radians * 180) / Math.PI;

/**
 * The faces an item of this shape and size carries its name on. A box prints
 * on its top, and — when it is tall enough to have a wall worth reading — on
 * one wall: the west wall when it is deeper than wide, else the south. A tent
 * prints on the roof slope that faces south, or west when the ridge runs
 * north–south (`meshes.ts`'s rule, the facing included). A sofa prints on the
 * seat, clear of the back. A net prints on a band inside its north edge.
 * `insetCm` is accepted for symmetry with the builders and unused: the band
 * is by the edge, not the strip.
 */
export function printSpots(
  shape: SiteKindShape, widthCm: number, depthCm: number, heightCm: number, facing: number, insetCm: number | null,
): PrintSpot[] {
  void insetCm;
  const w = widthCm;
  const d = depthCm;
  const h = heightCm;
  switch (shape) {
    case 'cylinder':
    case 'fire':
      return [spot('cap', w / 2, d / 2, h, w, d, 0, 'south')];
    case 'sofa': {
      // The back's slab, by the rule `meshes.ts`'s `sofaBack` keeps: north at 0, then east, south, west.
      const thick = Math.max(15, (facing % 2 === 0 ? d : w) * 0.26);
      const z = h * 0.5;
      switch (facing) {
        case 1: return [spot('seat', (w - thick) / 2, d / 2, z, w - thick, d, 0, 'south')];
        case 2: return [spot('seat', w / 2, (d - thick) / 2, z, w, d - thick, 0, 'south')];
        case 3: return [spot('seat', (w + thick) / 2, d / 2, z, w - thick, d, 0, 'south')];
        default: return [spot('seat', w / 2, (d + thick) / 2, z, w, d - thick, 0, 'south')];
      }
    }
    case 'tent': {
      const ridgeEastWest = w > d || (w === d && facing % 2 === 0);
      if (ridgeEastWest) {
        // The south slope: from the eave (y = d, z = h/2) up to the ridge (y = d/2, z = h).
        return [spot('roofSouth', w / 2, (d * 3) / 4, (h * 3) / 4, w, Math.hypot(d / 2, h / 2), degrees(Math.atan2(h / 2, d / 2)), 'south')];
      }
      // The west slope: from the eave (x = 0, z = h/2) up to the ridge (x = w/2, z = h).
      return [spot('roofWest', w / 4, d / 2, (h * 3) / 4, d, Math.hypot(w / 2, h / 2), degrees(Math.atan2(h / 2, w / 2)), 'west')];
    }
    case 'net':
      return [spot('cloth', w / 2, Math.min(CLOTH_BAND_CM, d / 4), h, w, d, 0, 'south')];
    default: {
      const spots = [
        d > w * LONG_TOP
          ? spot('top', w / 2, d / 2, h, d, w, 0, 'west')
          : spot('top', w / 2, d / 2, h, w, d, 0, 'south'),
      ];
      if (h >= WALL_FROM_CM) {
        spots.push(d > w
          ? spot('wallWest', 0, d / 2, h / 2, d, h, 90, 'west')
          : spot('wallSouth', w / 2, d, h / 2, w, h, 90, 'south'));
      }
      return spots;
    }
  }
}

/** The print's own size on a spot: fitted inside the spot's fraction of its face, keeping `aspect` (width ÷ height). Whole centimetres. */
export function fitPrint(spot: PrintSpot, aspect: number): { widthCm: number; heightCm: number } {
  if (!(aspect > 0)) return { widthCm: 0, heightCm: 0 };
  const widthCm = Math.round(Math.min(spot.fracW * spot.widthCm, aspect * spot.fracH * spot.heightCm));
  return { widthCm, heightCm: Math.round(widthCm / aspect) };
}
