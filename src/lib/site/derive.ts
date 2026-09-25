import type { SiteItemKind } from '@/db/schema/site';
import { itemHeight, type KindDefaults } from './defaults';
import {
  areaM2, outsideIds, overlapPairs, ropeOffsetCm, shadeCounts, shadeState,
  type PlacedItem, type Plot, type ShadeCounts, type ShadeState,
} from './geometry';

/**
 * The flags the screen draws — outside, overlapping, in shade — derived from
 * the rows and never stored. Pure and free of the database on purpose: the
 * editor's store re-derives them after every edit, in the browser
 * (`use-editor-store.ts`), so the checks bar and the inspector flag a tent the
 * moment it crosses the fence and not after the save's round trip. `plan.ts`
 * calls the same function for the server's read, which the item table draws,
 * so the two can never disagree about what "outside" means.
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
  shade: ShadeCounts;
}

export interface Derived<Item extends ItemShape> {
  items: Array<Item & ItemFlags>;
  counts: SiteCounts;
  /** Every overlapping pair of item ids — the same list `counts.overlapPairs` is the length of, so a caller that needs the pairs themselves (the store's flags) is not left recomputing them. */
  pairs: Array<[string, string]>;
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

export function derive<Item extends ItemShape>(
  plot: PlotShape, items: readonly Item[],
): Derived<Item> {
  const placed = items.map((item) => toPlaced(item));
  const bounds: Plot = { widthCm: plot.widthCm, depthCm: plot.depthCm };
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
      shade: shadeCounts(placed),
    },
    pairs,
  };
}
