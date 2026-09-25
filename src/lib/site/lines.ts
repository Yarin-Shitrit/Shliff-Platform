import type { SiteItemKind, SiteLineKind, SiteLinePoint } from '@/db/schema/site';
import type { EditorDoc, EditorItem, EditorLine } from './editor/model';
import type { Rect } from './geometry';

/**
 * The pipes and cables (`site_lines`): what each kind of line may join, where
 * on an item it starts, and how long it is. Pure, like `geometry.ts` — the
 * inspector, the scene and the server all measure with the same arithmetic,
 * so the metres a lead reads on screen are the metres the totals add up.
 *
 * A line joins items, never points, and only items that carry that utility:
 * water runs between a drinking-water tank, a shower and a sink — a toilet
 * takes none — and power between the generator, a fridge and a light. Two
 * consumers may be joined to each other (a pipe that branches at the first
 * shower, a cable daisy-chained from one light to the next); what is refused
 * is an end that has nothing to do with the utility at all. Whether a fridge
 * is actually reached from the generator is `unconnected` below — a fact
 * the screen states, never a reason to refuse a line.
 *
 * Length is measured from wall to wall, not centre to centre: a cable to a
 * caravan starts at the caravan's side. It is the length on the map, with
 * no reserve for slack, height or what the ground does — the screen says so,
 * and the lead adds what the playa asks.
 */

export interface LineKindPreset {
  label: string;
  /** "3 צינורות מים" */
  plural: string;
  /** What the line carries, for sentences: "חיבור למים". */
  noun: string;
  /** Kinds that give — a tank, the generator. */
  sources: readonly SiteItemKind[];
  /** Kinds that take. */
  consumers: readonly SiteItemKind[];
}

export const LINE_KINDS: Record<SiteLineKind, LineKindPreset> = {
  water: {
    label: 'צינור מים', plural: 'צינורות מים', noun: 'מים',
    sources: ['water'], consumers: ['shower', 'sink'],
  },
  power: {
    label: 'כבל חשמל', plural: 'כבלי חשמל', noun: 'חשמל',
    sources: ['generator'], consumers: ['fridge', 'light'],
  },
};

export const LINE_KIND_ORDER: readonly SiteLineKind[] = ['water', 'power'];

export function isSiteLineKind(value: string): value is SiteLineKind {
  return Object.prototype.hasOwnProperty.call(LINE_KINDS, value);
}

/** Whether an item of this kind may be an end of this kind of line, giving or taking. */
export function joins(kind: SiteLineKind, itemKind: SiteItemKind): boolean {
  const preset = LINE_KINDS[kind];
  return preset.sources.includes(itemKind) || preset.consumers.includes(itemKind);
}

/** The utilities an item of this kind takes part in — what the inspector offers to connect. */
export function lineKindsOf(itemKind: SiteItemKind): SiteLineKind[] {
  return LINE_KIND_ORDER.filter((kind) => joins(kind, itemKind));
}

/**
 * Why two items may not be joined by a line of this kind, or null. English
 * with a stable prefix, like every refusal in `src/lib/site/`;
 * `failure-messages.ts` says it in Hebrew.
 */
export function endpointRefusal(kind: SiteLineKind, fromKind: SiteItemKind, toKind: SiteItemKind, sameItem: boolean): string | null {
  if (sameItem) return 'a line must join two different items';
  if (!joins(kind, fromKind) || !joins(kind, toKind)) {
    return kind === 'water'
      ? 'a water pipe joins only a drinking-water tank, a shower or a sink'
      : 'a power cable joins only the generator, a fridge or a light';
  }
  return null;
}

function centreOf(rect: Rect): [number, number] {
  return [rect.x + rect.width / 2, rect.y + rect.depth / 2];
}

function inside(rect: Rect, [x, y]: readonly [number, number]): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.depth;
}

/**
 * Where a line leaves an item: the point on the item's outline that the
 * straight line from its middle toward `toward` crosses, in whole
 * centimetres. A `toward` inside the item — two items that overlap — gives
 * the middle itself, so the line is still drawn and still measured rather
 * than vanishing.
 */
export function anchorOf(rect: Rect, toward: readonly [number, number]): SiteLinePoint {
  const [cx, cy] = centreOf(rect);
  const dx = toward[0] - cx;
  const dy = toward[1] - cy;
  if ((dx === 0 && dy === 0) || inside(rect, toward)) return [Math.round(cx), Math.round(cy)];
  const tx = dx === 0 ? Infinity : (rect.width / 2) / Math.abs(dx);
  const ty = dy === 0 ? Infinity : (rect.depth / 2) / Math.abs(dy);
  const t = Math.min(tx, ty);
  return [Math.round(cx + dx * t), Math.round(cy + dy * t)];
}

/**
 * The line as it is drawn and measured: from the first item's wall, through
 * every bend, to the second item's wall. The first and last legs aim at the
 * nearest bend, or at the other item's middle when there is none.
 */
export function linePath(points: readonly SiteLinePoint[], from: Rect, to: Rect): SiteLinePoint[] {
  const first = points[0] ?? centreOf(to);
  const last = points[points.length - 1] ?? centreOf(from);
  return [anchorOf(from, first), ...points.map((p): SiteLinePoint => [p[0], p[1]]), anchorOf(to, last)];
}

/** Whole centimetres along a path, rounded once at the end. */
export function pathLengthCm(path: readonly SiteLinePoint[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  }
  return Math.round(total);
}

/** The line's path on this doc, or null when an end is no longer on the map. */
export function pathOf(doc: EditorDoc, line: EditorLine): SiteLinePoint[] | null {
  const from = doc.items.find((item) => item.id === line.fromId);
  const to = doc.items.find((item) => item.id === line.toId);
  if (from === undefined || to === undefined) return null;
  // `model.ts`'s `rectOf`, written out: `model.ts` imports this file's presets, so this file imports no value from it.
  const rect = (item: EditorItem): Rect => ({ x: item.xCm, y: item.yCm, width: item.widthCm, depth: item.depthCm });
  return linePath(line.points, rect(from), rect(to));
}

export function lineLengthCm(doc: EditorDoc, line: EditorLine): number | null {
  const path = pathOf(doc, line);
  return path === null ? null : pathLengthCm(path);
}

export interface LineTotals {
  kind: SiteLineKind;
  ids: string[];
  /** The sum of every line's length, whole centimetres. */
  lengthCm: number;
}

/** What the camp has to buy, per utility: how many runs and how many metres, over the lines whose ends are both on the map. */
export function lineTotals(doc: EditorDoc): Record<SiteLineKind, LineTotals> {
  const out = { water: { kind: 'water', ids: [], lengthCm: 0 }, power: { kind: 'power', ids: [], lengthCm: 0 } } as Record<SiteLineKind, LineTotals>;
  for (const line of doc.lines) {
    const length = lineLengthCm(doc, line);
    if (length === null) continue;
    out[line.kind].ids.push(line.id);
    out[line.kind].lengthCm += length;
  }
  return out;
}

/**
 * The consumers of a utility that no chain of its lines reaches from a
 * source: the fridge with no cable, or a light whose only cable goes to
 * another light that has none either. Stated, never refused (§13): a map
 * with the tanks placed and the pipes not yet drawn is a map in progress.
 * In the order the items stand in the doc.
 */
export function unconnected(doc: EditorDoc, kind: SiteLineKind): string[] {
  const preset = LINE_KINDS[kind];
  const reached = new Set<string>(doc.items.filter((item) => preset.sources.includes(item.kind)).map((item) => item.id));
  const edges = doc.lines.filter((line) => line.kind === kind);
  let grew = true;
  while (grew) {
    grew = false;
    for (const line of edges) {
      const a = reached.has(line.fromId);
      const b = reached.has(line.toId);
      if (a !== b) {
        reached.add(a ? line.toId : line.fromId);
        grew = true;
      }
    }
  }
  return doc.items
    .filter((item) => preset.consumers.includes(item.kind) && !reached.has(item.id))
    .map((item) => item.id);
}

/**
 * The items a new line of this kind could run from `itemId` to: every other
 * item that carries the utility and is not already joined to it by a line of
 * this kind — two pipes between the same tank and the same shower measure
 * the same run twice.
 */
export function eligibleEnds(doc: EditorDoc, itemId: string, kind: SiteLineKind): EditorItem[] {
  const origin = doc.items.find((item) => item.id === itemId);
  if (origin === undefined || !joins(kind, origin.kind)) return [];
  const joined = new Set<string>();
  for (const line of doc.lines) {
    if (line.kind !== kind) continue;
    if (line.fromId === itemId) joined.add(line.toId);
    if (line.toId === itemId) joined.add(line.fromId);
  }
  return doc.items.filter((item) => item.id !== itemId && joins(kind, item.kind) && !joined.has(item.id));
}
