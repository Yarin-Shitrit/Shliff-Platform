import type { SiteItemKind } from '@/db/schema/site';
import { itemHeight, type KindDefaults } from './defaults';
import {
  areaM2, groundRect, outsideIds, overlap, overlapPairs, ropeBandPairs, ropeOffsetCm, shadeCounts, shadeState,
  unionAreaM2, type PlacedItem, type Plot, type Rect, type ShadeCounts, type ShadeState,
} from './geometry';

/**
 * The flags the screen draws — outside, overlapping, in shade — derived from
 * the rows and never stored. Pure and free of the database on purpose: the
 * editor's store re-derives them after every edit, in the browser
 * (`use-editor-store.ts`), so the checks bar and the inspector flag a tent the
 * moment it crosses the fence and not after the save's round trip. `plan.ts`
 * calls the same function for the server's read, which the item table draws,
 * so the two can never disagree about what "outside" means.
 *
 * The camp's kind defaults give a net its rope footprint: the camp's angle
 * and its kind's height (spec §12). With no angle anywhere a net derives
 * exactly what it did before ropes existed (D16).
 */

export interface PlotShape {
  widthCm: number;
  depthCm: number;
  gridCm: number;
}

/** What an item needs to carry for the flags to be computed. */
export interface ItemShape {
  id: string;
  kind: SiteItemKind;
  xCm: number;
  yCm: number;
  widthCm: number;
  depthCm: number;
  insetCm: number | null;
  /** Null means the kind's height. A net's height sets how far out its stakes stand (spec D18). */
  heightCm: number | null;
  /** Shade nets only; null means the camp's angle for nets (spec D16). */
  ropeAngleDeg: number | null;
}

export interface ItemFlags {
  outside: boolean;
  overlapping: boolean;
  /** Null for a shade net — it is the thing that shades. */
  shade: ShadeState | null;
}

export interface SiteCounts {
  items: number;
  outside: number;
  /** Items involved in at least one overlap. */
  overlapping: number;
  overlapPairs: number;
  plotAreaM2: number;
  /** שטח תפוס (spec §3): the union of every item's footprint — a net's with its ropes — inside the fence, m² to one decimal. */
  takenAreaM2: number;
  shade: ShadeCounts;
}

export interface Derived<Item extends ItemShape> {
  items: Array<Item & ItemFlags>;
  counts: SiteCounts;
  /** Every overlapping pair of item ids — the same list `counts.overlapPairs` is the length of, so a caller that needs the pairs themselves (the store's flags) is not left recomputing them. */
  pairs: Array<[string, string]>;
  /** `[net id, item id]`: an item standing in a net's rope band (spec §15) — the checks bar's "בשטח החבלים". */
  ropePairs: Array<[string, string]>;
}

/**
 * How far a net's stakes stand from its cloth (spec §12): its height — its
 * own, else its kind's — over the tangent of its angle — its own, else the
 * camp's for nets. 0 for anything that is not a net, and for a net while
 * neither angle is set: until the camp sets one, a net is checked by its
 * cloth, exactly as it always was (D16).
 */
export function ropeCmOf(
  item: Pick<ItemShape, 'kind' | 'heightCm' | 'ropeAngleDeg'>, defaults: KindDefaults,
): number {
  if (item.kind !== 'shade') return 0;
  const angle = item.ropeAngleDeg ?? defaults.shade?.ropeAngleDeg ?? null;
  return angle === null ? 0 : ropeOffsetCm(itemHeight(item, defaults), angle);
}

/**
 * An item as the geometry sees it. `defaults` — the camp's kind defaults —
 * give a net the camp's rope angle and its kind's height; without them only
 * a net's own angle places its ropes, which is all a shade question needs.
 */
export function toPlaced(item: ItemShape, defaults: KindDefaults = {}): PlacedItem {
  return {
    id: item.id, kind: item.kind, insetCm: item.insetCm, ropeCm: ropeCmOf(item, defaults),
    x: item.xCm, y: item.yCm, width: item.widthCm, depth: item.depthCm,
  };
}

export interface TakenArea {
  /** m², one decimal. */
  areaM2: number;
  /** The items whose footprint reaches inside the fence: what the figure counts, and what pressing it selects. */
  ids: string[];
  /** Whether any net's ropes are in it — "כולל החבלים של רשתות הצל". */
  withRopes: boolean;
}

/**
 * שטח תפוס (spec §3, §15): the ground the items take, as the union of their
 * footprints — a net's with its ropes — inside the fence. The plot
 * inspector shows it against the plot's area; `derive` counts it.
 */
export function takenArea(plot: Plot, placed: readonly PlacedItem[]): TakenArea {
  const field: Rect = { x: 0, y: 0, width: plot.widthCm, depth: plot.depthCm };
  const footprints = placed.map(groundRect);
  return {
    areaM2: unionAreaM2(footprints, plot),
    ids: placed.flatMap((entry, index) => (overlap(footprints[index], field) ? [entry.id] : [])),
    withRopes: placed.some((entry) => entry.ropeCm > 0),
  };
}

export function derive<Item extends ItemShape>(
  plot: PlotShape, items: readonly Item[], defaults: KindDefaults = {},
): Derived<Item> {
  const placed = items.map((item) => toPlaced(item, defaults));
  const bounds: Plot = { widthCm: plot.widthCm, depthCm: plot.depthCm };
  // By footprint: a net whose ropes cross the fence is outside (D8).
  const outside = new Set(outsideIds(placed, bounds));
  const pairs = overlapPairs(placed);
  const overlapping = new Set(pairs.flat());
  const shades = placed.filter((item) => item.kind === 'shade');

  return {
    items: items.map((item, index) => ({
      ...item,
      outside: outside.has(item.id),
      overlapping: overlapping.has(item.id),
      shade: item.kind === 'shade' ? null : shadeState(placed[index], shades),
    })),
    counts: {
      items: items.length,
      outside: outside.size,
      overlapping: overlapping.size,
      overlapPairs: pairs.length,
      plotAreaM2: areaM2(bounds),
      takenAreaM2: takenArea(bounds, placed).areaM2,
      shade: shadeCounts(placed),
    },
    pairs,
    ropePairs: ropeBandPairs(placed),
  };
}
