import type { SiteItemKind, SiteLineKind, SiteLinePoint } from '@/db/schema/site';
import type { KindDefaults } from '../defaults';
import type { Rect } from '../geometry';
import { SITE_KINDS } from '../kinds';
import { LINE_KINDS } from '../lines';

/**
 * What the editor holds once the page has loaded (spec §6.1): the server's
 * rows without what only the server needs — timestamps, task titles.
 * Whole centimetres throughout; x east, y south.
 */
export interface EditorItem {
  id: string;
  kind: SiteItemKind;
  label: string;
  xCm: number;
  yCm: number;
  widthCm: number;
  depthCm: number;
  /** Null means the kind's height (`defaults.ts`). */
  heightCm: number | null;
  /** Shade nets only: the unshaded strip on every side. */
  insetCm: number | null;
  sort: number;
  taskId: string | null;
  notes: string | null;
  locked: boolean;
}

export interface EditorPlot {
  id: string;
  widthCm: number;
  depthCm: number;
  gridCm: number;
  /** The compass bearing of the map's "up"; 0 is north. */
  northDeg: number;
}

/**
 * A pipe or a cable between two items (`site_lines`): its ends are item ids,
 * so it follows them; `points` are the bends between the ends, in order,
 * whole centimetres. The rules of which kinds it may join, and its length,
 * are `src/lib/site/lines.ts`'s.
 */
export interface EditorLine {
  id: string;
  kind: SiteLineKind;
  label: string;
  fromId: string;
  toId: string;
  points: SiteLinePoint[];
  sort: number;
  notes: string | null;
}

export interface EditorDoc {
  plot: EditorPlot;
  items: EditorItem[];
  lines: EditorLine[];
  defaults: KindDefaults;
}

export function rectOf(item: Pick<EditorItem, 'xCm' | 'yCm' | 'widthCm' | 'depthCm'>): Rect {
  return { x: item.xCm, y: item.yCm, width: item.widthCm, depth: item.depthCm };
}

export function findItem(doc: EditorDoc, id: string): EditorItem | undefined {
  return doc.items.find((entry) => entry.id === id);
}

export function findLine(doc: EditorDoc, id: string): EditorLine | undefined {
  return doc.lines.find((entry) => entry.id === id);
}

/** Every line with this item at either end, in the order the doc holds them. */
export function linesAt(doc: EditorDoc, itemId: string): EditorLine[] {
  return doc.lines.filter((line) => line.fromId === itemId || line.toId === itemId);
}

/** "כבל חשמל 3": numbered like items are (`nextLabel`), per line kind. */
export function nextLineLabel(lines: readonly EditorLine[], kind: SiteLineKind): string {
  let top = 0;
  for (const entry of lines) {
    if (entry.kind !== kind) continue;
    const match = /(\d+)\s*$/.exec(entry.label);
    top = Math.max(top, match ? Number(match[1]) : 1);
  }
  return `${LINE_KINDS[kind].label} ${top + 1}`;
}

/**
 * "אוהל 8": one past the highest number any item of the kind carries, an
 * unnumbered one counting as 1. By the highest rather than by the count, so a
 * removal never makes the next tent share a name with a surviving one.
 */
export function nextLabel(items: readonly EditorItem[], kind: SiteItemKind): string {
  let top = 0;
  for (const entry of items) {
    if (entry.kind !== kind) continue;
    const match = /(\d+)\s*$/.exec(entry.label);
    top = Math.max(top, match ? Number(match[1]) : 1);
  }
  return `${SITE_KINDS[kind].label} ${top + 1}`;
}
