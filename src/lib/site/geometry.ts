import type { SiteItemKind } from '@/db/schema/site';

/**
 * The arithmetic of the camp map, with no DOM and no database in it.
 *
 * Everything is an integer number of centimetres (see `src/db/schema/site.ts`
 * for why). Every function here is pure and returns a new value, so a drag
 * can be replayed in a test as a list of deltas and the answer checked by
 * hand against graph paper — which is how the plot was designed in the first
 * place.
 *
 * Unlike `src/components/charts/geometry.ts`, nothing here mirrors for RTL.
 * The map is a physical thing: the kitchen is where the kitchen is whatever
 * language the page is in, and `x` grows the way it grows on the sketch.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  depth: number;
}

export interface Plot {
  widthCm: number;
  depthCm: number;
}

/** What the geometry needs to know about an item; the rest is the screen's. */
export interface PlacedItem extends Rect {
  id: string;
  kind: SiteItemKind;
  /** Shade nets only: the unshaded strip on each side. */
  insetCm: number | null;
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const HANDLES: readonly Handle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** A side can never be thinner than this. Ten centimetres is a tent pole. */
export const MIN_SIDE_CM = 10;

/** Nearest grid line. A step of zero or less means no grid, so the value is kept. */
export function snap(cm: number, step: number): number {
  if (step <= 0) return Math.round(cm);
  return Math.round(cm / step) * step;
}

/** Fully inside, edges included: a tent flush against the fence is on the plot. */
export function contains(plot: Plot, rect: Rect): boolean {
  return rect.x >= 0
    && rect.y >= 0
    && rect.x + rect.width <= plot.widthCm
    && rect.y + rect.depth <= plot.depthCm;
}

/**
 * Strict: two rectangles that share an edge do not overlap. A sofa pushed
 * against a table is how a lounge is arranged, not a collision.
 */
export function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width
    && b.x < a.x + a.width
    && a.y < b.y + b.depth
    && b.y < a.y + a.depth;
}

function isShade(item: PlacedItem): boolean {
  return item.kind === 'shade';
}

/**
 * Every pair of items that sit on the same ground. A shade net is on neither
 * side of a pair: things go *under* it, which is the point of it, and two
 * nets that overlap are simply doubled shade.
 *
 * Ordered by the input, first item first, so the list is stable across
 * renders and a test can name the pair it expects.
 */
export function overlapPairs(items: readonly PlacedItem[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < items.length; i += 1) {
    if (isShade(items[i])) continue;
    for (let j = i + 1; j < items.length; j += 1) {
      if (isShade(items[j])) continue;
      if (overlap(items[i], items[j])) pairs.push([items[i].id, items[j].id]);
    }
  }
  return pairs;
}

/** Items not fully inside the plot — after the plot shrank, or after a drag past the fence. */
export function outsideIds(items: readonly PlacedItem[], plot: Plot): string[] {
  return items.filter((item) => !contains(plot, item)).map((item) => item.id);
}

export function move(rect: Rect, dxCm: number, dyCm: number, step: number): Rect {
  return {
    ...rect,
    x: snap(rect.x + dxCm, step),
    y: snap(rect.y + dyCm, step),
  };
}

/**
 * Drag one of the eight handles. The opposite edge stays where it is, the
 * dragged edge snaps, and the side never drops under `minCm`: a handle
 * pulled past the far edge stops at the minimum rather than flipping the
 * rectangle inside out.
 */
export function resize(
  rect: Rect, handle: Handle, dxCm: number, dyCm: number, step: number, minCm = MIN_SIDE_CM,
): Rect {
  let left = rect.x;
  let right = rect.x + rect.width;
  let top = rect.y;
  let bottom = rect.y + rect.depth;

  if (handle.includes('e')) right = Math.max(left + minCm, snap(right + dxCm, step));
  if (handle.includes('w')) left = Math.min(right - minCm, snap(left + dxCm, step));
  if (handle.includes('s')) bottom = Math.max(top + minCm, snap(bottom + dyCm, step));
  if (handle.includes('n')) top = Math.min(bottom - minCm, snap(top + dyCm, step));

  return { x: left, y: top, width: right - left, depth: bottom - top };
}

/** A quarter turn. The item pivots on its own corner, which is where a lead expects it. */
export function swapSides(rect: Rect): Rect {
  return { ...rect, width: rect.depth, depth: rect.width };
}

/**
 * Where a new item lands: the first grid cell, reading across then down,
 * where it fits inside the plot and sits on nobody. Null when the plot has no
 * such spot — the caller then says so rather than inventing one.
 *
 * A shade net is not an obstacle (a new sofa may land under it), and a new
 * shade net may land over anything, for the same reason `overlapPairs` gives.
 */
export function placeNew(
  items: readonly PlacedItem[], plot: Plot, size: { width: number; depth: number },
  step: number, kind: SiteItemKind,
): { x: number; y: number } | null {
  const stride = step > 0 ? step : 10;
  const obstacles = kind === 'shade' ? [] : items.filter((item) => !isShade(item));

  for (let y = 0; y + size.depth <= plot.depthCm; y += stride) {
    for (let x = 0; x + size.width <= plot.widthCm; x += stride) {
      const candidate: Rect = { x, y, width: size.width, depth: size.depth };
      if (!obstacles.some((item) => overlap(item, candidate))) return { x, y };
    }
  }
  return null;
}

/**
 * The ground a shade net actually shades: its footprint minus the strip on
 * every side. Null when the net is too small to shade anything at all — a
 * 1 × 1 net with 50 cm of sag is a flag, not a lounge.
 */
export function shadedRect(shade: PlacedItem): Rect | null {
  const inset = shade.insetCm ?? 0;
  const width = shade.width - inset * 2;
  const depth = shade.depth - inset * 2;
  if (width <= 0 || depth <= 0) return null;
  return { x: shade.x + inset, y: shade.y + inset, width, depth };
}

export type ShadeState = 'shaded' | 'partly' | 'unshaded';

/**
 * Whether an item sits in shade. `shaded` is fully inside some net's shaded
 * ground; `partly` touches a net's footprint but is not fully inside its
 * shaded ground — the sofa that sits in the sag strip, which is the case the
 * lead most needs to be told about, because on the sketch it looks covered;
 * `unshaded` touches no net at all.
 */
export function shadeState(item: Rect, shades: readonly PlacedItem[]): ShadeState {
  let touches = false;
  for (const shade of shades) {
    const shaded = shadedRect(shade);
    if (shaded !== null && contains(
      { widthCm: shaded.x + shaded.width, depthCm: shaded.y + shaded.depth },
      item,
    ) && item.x >= shaded.x && item.y >= shaded.y) {
      return 'shaded';
    }
    if (overlap(shade, item)) touches = true;
  }
  return touches ? 'partly' : 'unshaded';
}

export interface ShadeCounts {
  nets: number;
  shaded: number;
  partly: number;
  unshaded: number;
  /** Sum of every net's shaded ground. Nets that overlap are counted twice — this is what the nets cover, not a union. */
  shadedAreaM2: number;
}

export function shadeCounts(items: readonly PlacedItem[]): ShadeCounts {
  const shades = items.filter(isShade);
  const counts: ShadeCounts = {
    nets: shades.length, shaded: 0, partly: 0, unshaded: 0, shadedAreaM2: 0,
  };
  for (const shade of shades) {
    const shaded = shadedRect(shade);
    if (shaded !== null) counts.shadedAreaM2 += areaM2(shaded);
  }
  for (const item of items) {
    if (isShade(item)) continue;
    counts[shadeState(item, shades)] += 1;
  }
  counts.shadedAreaM2 = Math.round(counts.shadedAreaM2 * 10) / 10;
  return counts;
}

/** Square metres, to one decimal: 2600 × 2400 cm is 624. */
export function areaM2(size: { width: number; depth: number } | Plot): number {
  const width = 'width' in size ? size.width : size.widthCm;
  const depth = 'depth' in size ? size.depth : size.depthCm;
  return Math.round((width * depth) / 1000) / 10;
}

/** `350` → `3.5`, `300` → `3`, `275` → `2.75`. No unit — the caller adds it. */
export function metres(cm: number): string {
  return String(Math.round(cm) / 100);
}

/** `3.5 מ׳` */
export function formatMetres(cm: number): string {
  return `${metres(cm)} מ׳`;
}

/** `3 × 3 מ׳` */
export function formatSize(widthCm: number, depthCm: number): string {
  return `${metres(widthCm)} × ${metres(depthCm)} מ׳`;
}

/** `624 מ״ר` */
export function formatArea(m2: number): string {
  return `${m2} מ״ר`;
}

/**
 * A quarter turn about the item's own middle (spec D5): in 3D a lead expects
 * the caravan to spin in place. Whole centimetres: when the sides differ by
 * an odd number the middle moves by half a centimetre, rounded.
 */
export function turnAboutCentre(rect: Rect): Rect {
  const doubledX = rect.x * 2 + rect.width;
  const doubledY = rect.y * 2 + rect.depth;
  const width = rect.depth;
  const depth = rect.width;
  return { x: Math.round((doubledX - width) / 2), y: Math.round((doubledY - depth) / 2), width, depth };
}

/** The smallest rectangle holding them all; null for none. */
export function unionRect(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.x); top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width); bottom = Math.max(bottom, rect.y + rect.depth);
  }
  return { x: left, y: top, width: right - left, depth: bottom - top };
}

export interface Gap {
  from: [number, number];
  to: [number, number];
  lengthCm: number;
}

/**
 * The clear ground on each side of a rectangle while it is dragged: to the
 * nearest thing that shares its rows (east/west) or columns (south/north),
 * else to the fence. Only gaps above zero and under `maxCm` are returned —
 * the ones a lead is deciding about. Order: east, west, south, north.
 */
export function gapsAround(rect: Rect, others: readonly Rect[], plot: Plot, maxCm = 600): Gap[] {
  const midX = Math.round(rect.x + rect.width / 2);
  const midY = Math.round(rect.y + rect.depth / 2);
  const sharesRows = (o: Rect) => o.y < rect.y + rect.depth && o.y + o.depth > rect.y;
  const sharesColumns = (o: Rect) => o.x < rect.x + rect.width && o.x + o.width > rect.x;
  let east = plot.widthCm - (rect.x + rect.width);
  let west = rect.x;
  let south = plot.depthCm - (rect.y + rect.depth);
  let north = rect.y;
  for (const o of others) {
    if (sharesRows(o) && o.x >= rect.x + rect.width) east = Math.min(east, o.x - (rect.x + rect.width));
    if (sharesRows(o) && o.x + o.width <= rect.x) west = Math.min(west, rect.x - (o.x + o.width));
    if (sharesColumns(o) && o.y >= rect.y + rect.depth) south = Math.min(south, o.y - (rect.y + rect.depth));
    if (sharesColumns(o) && o.y + o.depth <= rect.y) north = Math.min(north, rect.y - (o.y + o.depth));
  }
  const gaps: Gap[] = [];
  const keep = (length: number) => length > 0 && length < maxCm;
  if (keep(east)) gaps.push({ from: [rect.x + rect.width, midY], to: [rect.x + rect.width + east, midY], lengthCm: east });
  if (keep(west)) gaps.push({ from: [rect.x - west, midY], to: [rect.x, midY], lengthCm: west });
  if (keep(south)) gaps.push({ from: [midX, rect.y + rect.depth], to: [midX, rect.y + rect.depth + south], lengthCm: south });
  if (keep(north)) gaps.push({ from: [midX, rect.y - north], to: [midX, rect.y], lengthCm: north });
  return gaps;
}
