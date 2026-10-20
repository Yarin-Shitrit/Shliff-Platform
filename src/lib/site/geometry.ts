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

/**
 * The four fence lengths of a plot that is not a rectangle, whole
 * centimetres, named by the map's compass: north and south are the rows the
 * map's "up" and "down" run along, west and east the sides that close them.
 */
export interface PlotSides {
  northCm: number;
  southCm: number;
  westCm: number;
  eastCm: number;
}

/**
 * The plot. `widthCm` × `depthCm` is its bounding box, and the whole of it
 * when `sides` is absent or null. With `sides` the fence is the four-sided
 * figure `fourSidedPlot` makes of them, drawn inside that box.
 */
export interface Plot {
  widthCm: number;
  depthCm: number;
  sides?: PlotSides | null;
}

/** A point on the map, whole centimetres: x east, y south. */
export type Corner = [number, number];

/** A plot's four corners walked clockwise from the north-west: NW, NE, SE, SW. */
export type Corners = [Corner, Corner, Corner, Corner];

export interface FourSidedPlot {
  /** The box the fence fits in. */
  widthCm: number;
  depthCm: number;
  corners: Corners;
}

/**
 * A fence a lead measured as four lengths, as corners on the map. North and
 * south are taken as parallel, which is what fixes the shape: with
 * Δ = south − north, the south-west corner stands p = (east² − west² − Δ²) ÷ 2Δ
 * east of the north-west one (negative is west of it), and the fence is
 * √(west² − p²) deep. The longer of north and south spans the box's width;
 * the shorter sits in from the box's edge by what the sides demand.
 *
 * Null when no such fence closes: a side too short for the other three to
 * meet it, or north equal to south with west not equal to east — a
 * parallelogram, where any lean would do and the system does not pick one.
 * Four lengths with equal opposites are the rectangle, p = 0. Whole
 * centimetres throughout: the corners are rounded once, so the drawn sides
 * may differ from the typed ones by under a centimetre.
 */
export function fourSidedPlot(sides: PlotSides): FourSidedPlot | null {
  const { northCm: north, southCm: south, westCm: west, eastCm: east } = sides;
  if (![north, south, west, east].every((side) => Number.isInteger(side) && side > 0)) return null;
  const delta = south - north;
  let run: number;
  if (delta === 0) {
    if (west !== east) return null;
    run = 0;
  } else {
    run = (east * east - west * west - delta * delta) / (2 * delta);
  }
  const depthSquared = west * west - run * run;
  if (depthSquared <= 0) return null;
  const depthCm = Math.round(Math.sqrt(depthSquared));
  if (depthCm < 1) return null;
  const southWestX = Math.max(Math.round(run), 0);
  const northWestX = Math.max(Math.round(-run), 0);
  return {
    widthCm: Math.max(northWestX + north, southWestX + south),
    depthCm,
    corners: [
      [northWestX, 0], [northWestX + north, 0],
      [southWestX + south, depthCm], [southWestX, depthCm],
    ],
  };
}

/** The plot's fence as corners: the four-sided figure of its sides, else its box. Sides that do not close fall back to the box — `plan.ts` never stores such sides. */
export function plotCorners(plot: Plot): Corners {
  const four = plot.sides === undefined || plot.sides === null ? null : fourSidedPlot(plot.sides);
  if (four !== null) return four.corners;
  return [[0, 0], [plot.widthCm, 0], [plot.widthCm, plot.depthCm], [0, plot.depthCm]];
}

/** Whether a plot's fence is its box: no sides, or sides that make a rectangle. */
export function isRectangle(plot: Plot): boolean {
  const corners = plotCorners(plot);
  return corners[0][0] === corners[3][0] && corners[1][0] === corners[2][0];
}

/**
 * Where `point` stands against the edge `from` → `to`: positive inside a
 * clockwise fence, zero on the edge. The sign of the cross product.
 */
function side(from: Corner, to: Corner, point: Corner): number {
  return (to[0] - from[0]) * (point[1] - from[1]) - (to[1] - from[1]) * (point[0] - from[0]);
}

/** A point on the fence or inside it. The fence is convex, so one side test per edge is the whole answer. */
export function insideFence(corners: Corners, point: Corner): boolean {
  for (let i = 0; i < 4; i += 1) {
    if (side(corners[i], corners[(i + 1) % 4], point) < 0) return false;
  }
  return true;
}

/**
 * The stretch of the line `x = at` (`axis` 'x') or `y = at` (`axis` 'y')
 * that lies inside the fence, as `[from, to]` along the other axis in whole
 * centimetres; null when the line misses the fence. Each edge's "inside"
 * half-plane is linear along the line, so each one either bounds the stretch
 * from one end or rules the whole line out. The grid is drawn with this, and
 * the gap readouts measure to the fence with it.
 */
export function fenceSpan(corners: Corners, axis: 'x' | 'y', at: number): [number, number] | null {
  let low = -Infinity;
  let high = Infinity;
  for (let i = 0; i < 4; i += 1) {
    const [px, py] = corners[i];
    const [qx, qy] = corners[(i + 1) % 4];
    /* side(P, Q, R) ≥ 0 with one coordinate of R fixed is A·t ≥ B in the other. */
    const [a, b] = axis === 'x'
      ? [qx - px, (qy - py) * (at - px) + (qx - px) * py]
      : [-(qy - py), -((qx - px) * (at - py) + (qy - py) * px)];
    if (a > 0) low = Math.max(low, b / a);
    else if (a < 0) high = Math.min(high, b / a);
    else if (b > 0) return null;
  }
  if (low > high) return null;
  return [wholeCm(low), wholeCm(high)];
}

/** What the geometry needs to know about an item; the rest is the screen's. */
export interface PlacedItem extends Rect {
  id: string;
  kind: SiteItemKind;
  /** Shade nets only: the unshaded strip on each side. */
  insetCm: number | null;
  /**
   * How far the net's stakes stand out from its cloth, whole centimetres
   * (spec §12). 0 for anything but a net, and for a net with no angle
   * anywhere (D16). `derive.ts`'s `toPlaced` fills it.
   */
  ropeCm: number;
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

/**
 * Fully inside, edges included: a tent flush against the fence is on the
 * plot. Inside the box first; then, on a four-sided plot, each of the
 * rectangle's corners inside the fence — enough, because the fence is convex.
 */
export function contains(plot: Plot, rect: Rect): boolean {
  const inBox = rect.x >= 0
    && rect.y >= 0
    && rect.x + rect.width <= plot.widthCm
    && rect.y + rect.depth <= plot.depthCm;
  if (!inBox || plot.sides === undefined || plot.sides === null) return inBox;
  const corners = plotCorners(plot);
  return insideFence(corners, [rect.x, rect.y])
    && insideFence(corners, [rect.x + rect.width, rect.y])
    && insideFence(corners, [rect.x + rect.width, rect.y + rect.depth])
    && insideFence(corners, [rect.x, rect.y + rect.depth]);
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

/**
 * Items not fully inside the plot — after the plot shrank, or after a drag
 * past the fence — by their footprint: a net whose ropes cross the fence is
 * outside, though its cloth is not (spec D8). Flush counts as inside.
 */
export function outsideIds(items: readonly PlacedItem[], plot: Plot): string[] {
  return items.filter((item) => !contains(plot, groundRect(item))).map((item) => item.id);
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

/**
 * Square metres, to one decimal: 2600 × 2400 cm is 624. A four-sided plot's
 * is its trapezium's — the mean of north and south, times its depth — not
 * its box's.
 */
export function areaM2(size: { width: number; depth: number } | Plot): number {
  if ('widthCm' in size && size.sides !== undefined && size.sides !== null) {
    const four = fourSidedPlot(size.sides);
    if (four !== null) {
      return Math.round(((size.sides.northCm + size.sides.southCm) * four.depthCm) / 2 / 1000) / 10;
    }
  }
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

/**
 * A plot's size in words: `26 × 24 מ׳` for a rectangle; for four sides, the
 * two rows then the two sides, `33 / 35 × 25 / 25 מ׳` — north / south ×
 * west / east, the way the camp says its ground.
 */
export function formatPlot(plot: Plot): string {
  if (plot.sides === undefined || plot.sides === null) return formatSize(plot.widthCm, plot.depthCm);
  const { northCm, southCm, westCm, eastCm } = plot.sides;
  return `${metres(northCm)} / ${metres(southCm)} × ${metres(westCm)} / ${metres(eastCm)} מ׳`;
}

/** `624 מ״ר` */
export function formatArea(m2: number): string {
  return `${m2} מ״ר`;
}

/**
 * A quarter turn about the item's own middle (spec D5): in 3D a lead expects
 * the caravan to spin in place. Whole centimetres: when the sides differ by
 * an odd number the corner's shift is half a centimetre off whole, and it is
 * rounded away from zero on both axes — so the next turn's shift, the exact
 * opposite, rounds to the exact opposite, and the item comes back to where it
 * started after two turns and after four. Rounding the position instead
 * (half up) drifted it half a centimetre a turn (review minor).
 */
export function turnAboutCentre(rect: Rect): Rect {
  const width = rect.depth;
  const depth = rect.width;
  const shift = (half: number) => wholeCm(Math.sign(half) * Math.round(Math.abs(half)));
  return {
    x: rect.x + shift((rect.width - width) / 2),
    y: rect.y + shift((rect.depth - depth) / 2),
    width,
    depth,
  };
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
  /* East and west are measured to the fence along the readout's own row —
     on a four-sided plot the sides lean, and the figure is the line drawn. */
  const [fenceWest, fenceEast] = fenceSpan(plotCorners(plot), 'y', midY) ?? [0, plot.widthCm];
  let east = fenceEast - (rect.x + rect.width);
  let west = rect.x - fenceWest;
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

/** Whole centimetres, and never -0. */
export function wholeCm(value: number): number {
  return Math.round(value) || 0;
}

/* ── a shade net's ropes (spec Part B, §§12–15) ─────────────────────────── */

/**
 * Where a rope at `angleDeg` from the ground, tied `heightCm` up, meets the
 * ground: h ÷ tan θ (spec D9), in whole centimetres. 45° puts the stake as
 * far out as the cloth is high, 20° 2.7 times as far, 80° 0.18 times. The
 * angle is one `degrees.ts` accepts — whole, 20 to 80 — which every write
 * path checks, so the tangent here is never near zero or infinity.
 */
export function ropeOffsetCm(heightCm: number, angleDeg: number): number {
  return Math.round(heightCm / Math.tan((angleDeg * Math.PI) / 180));
}

/** The ground an item takes (spec D8): its rectangle, grown on every side by its ropes. A tent's is itself. */
export function groundRect(item: PlacedItem): Rect {
  const rope = item.ropeCm;
  return { x: item.x - rope, y: item.y - rope, width: item.width + rope * 2, depth: item.depth + rope * 2 };
}

/** `inner` wholly inside `outer`, edges included. */
function within(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.depth <= outer.y + outer.depth;
}

/**
 * Whether a rectangle stands in a net's rope band (spec §3, §15): it
 * overlaps the net's footprint and is not wholly under its cloth. Under the
 * cloth is what a net is for; between the cloth's edge and the stakes is
 * where somebody trips over a rope. A net without ropes has no band (D16).
 */
export function inRopeBand(rect: Rect, net: PlacedItem): boolean {
  return net.ropeCm > 0 && overlap(rect, groundRect(net)) && !within(net, rect);
}

/**
 * Every item standing in a net's rope band, as `[net id, item id]`, net by
 * net and then item by item in input order. Only something that is not a
 * net is ever in a band: two nets whose bands cross are two roofs' ropes,
 * which `overlapPairs` does not pair either. Every side of every net has
 * ropes (spec §27 Q2), so a tent under one net that reaches into its
 * neighbour's band is flagged — in the neighbour's band only.
 */
export function ropeBandPairs(items: readonly PlacedItem[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const net of items) {
    if (!isShade(net) || net.ropeCm === 0) continue;
    for (const other of items) {
      if (!isShade(other) && inRopeBand(other, net)) pairs.push([net.id, other.id]);
    }
  }
  return pairs;
}

/**
 * The area the rectangles cover together inside the plot, in square metres
 * to one decimal, like `areaM2` (spec §3, "שטח תפוס"): ground two of them
 * share is counted once, and whatever lies past the fence not at all. A
 * sweep across the rectangles' west and east edges: in each strip between two
 * neighbouring edges, the rectangles spanning it cover north–south runs,
 * merged and added. Integer centimetres until the one rounding at the end.
 */
export function unionAreaM2(rects: readonly Rect[], plot: Plot): number {
  const clipped: Rect[] = [];
  for (const rect of rects) {
    const west = Math.max(0, rect.x);
    const north = Math.max(0, rect.y);
    const east = Math.min(plot.widthCm, rect.x + rect.width);
    const south = Math.min(plot.depthCm, rect.y + rect.depth);
    if (east > west && south > north) clipped.push({ x: west, y: north, width: east - west, depth: south - north });
  }
  const edges = [...new Set(clipped.flatMap((rect) => [rect.x, rect.x + rect.width]))].sort((a, b) => a - b);
  let squareCm = 0;
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const west = edges[i];
    const east = edges[i + 1];
    const runs = clipped
      .filter((rect) => rect.x <= west && rect.x + rect.width >= east)
      .map((rect): [number, number] => [rect.y, rect.y + rect.depth])
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let run: [number, number] | null = null;
    for (const [north, south] of runs) {
      if (run === null || north > run[1]) {
        if (run !== null) covered += run[1] - run[0];
        run = [north, south];
      } else if (south > run[1]) {
        run[1] = south;
      }
    }
    if (run !== null) covered += run[1] - run[0];
    squareCm += covered * (east - west);
  }
  return Math.round(squareCm / 1000) / 10;
}

/**
 * What the gap readouts measure to while `moving` is dragged — the
 * "walkway" (spec §3, §14): every solid item as it stands, and every net
 * with ropes whose cloth `moving` does not touch, by its rope footprint. A
 * net over the moving item is the roof it stands under, not a wall. A net
 * without ropes is left out, as nets always were (D16).
 */
export function gapObstacles(others: readonly PlacedItem[], moving: Rect): Rect[] {
  const obstacles: Rect[] = [];
  for (const other of others) {
    if (!isShade(other)) obstacles.push({ x: other.x, y: other.y, width: other.width, depth: other.depth });
    else if (other.ropeCm > 0 && !overlap(other, moving)) obstacles.push(groundRect(other));
  }
  return obstacles;
}
