import type { SiteItemKind } from '@/db/schema/site';
import type { KindDefaults } from '../defaults';
import type { Rect } from '../geometry';
import { SITE_KINDS } from '../kinds';

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

export interface EditorDoc {
  plot: EditorPlot;
  items: EditorItem[];
  defaults: KindDefaults;
}

export function rectOf(item: Pick<EditorItem, 'xCm' | 'yCm' | 'widthCm' | 'depthCm'>): Rect {
  return { x: item.xCm, y: item.yCm, width: item.widthCm, depth: item.depthCm };
}

export function findItem(doc: EditorDoc, id: string): EditorItem | undefined {
  return doc.items.find((entry) => entry.id === id);
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
