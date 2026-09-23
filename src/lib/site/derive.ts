import type { SiteItemKind } from '@/db/schema/site';
import {
  areaM2, outsideIds, overlapPairs, shadeCounts, shadeState,
  type PlacedItem, type Plot, type ShadeCounts, type ShadeState,
} from './geometry';

/**
 * The flags the screen draws — outside, overlapping, in shade — derived from
 * the rows and never stored. Pure and free of the database on purpose: the
 * board re-derives them on every drag, in the browser, so the warning on a
 * tent appears the moment it crosses the fence and not after the round trip.
 * `plan.ts` calls the same function for the server render, so the two can
 * never disagree about what "outside" means.
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
}

export function toPlaced(item: ItemShape): PlacedItem {
  return {
    id: item.id, kind: item.kind, insetCm: item.insetCm,
    x: item.xCm, y: item.yCm, width: item.widthCm, depth: item.depthCm,
  };
}

export function derive<Item extends ItemShape>(
  plot: PlotShape, items: readonly Item[],
): Derived<Item> {
  const placed = items.map(toPlaced);
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
  };
}
