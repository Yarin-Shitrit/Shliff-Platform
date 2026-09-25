import type { SiteItemKind, SiteLineKind, SiteLinePoint } from '@/db/schema/site';
import type { KindDefaults } from '../defaults';
import type { Rect } from '../geometry';
import { SITE_KINDS } from '../kinds';
import { LINE_KINDS } from '../lines';
import type { UnderlayCalibration, UnderlayPlacement } from '../underlay';
import type { UnderlayContentType } from '../underlay-limits';

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

/**
 * The picture under the map (`site_underlays`, spec §17): its file and where
 * it lies, as the row holds them without their timestamps. How each viewer
 * sees it — shown or not, how see-through — is theirs alone
 * (`EditorUi.underlay`), never part of the doc (D19).
 */
export interface EditorUnderlay extends UnderlayPlacement {
  storageKey: string;
  contentType: UnderlayContentType;
  sizeBytes: number;
  filename: string;
  /** Null until the picture has been calibrated; the card then says its scale is temporary. */
  calibration: UnderlayCalibration | null;
}

export interface EditorDoc {
  plot: EditorPlot;
  items: EditorItem[];
  lines: EditorLine[];
  defaults: KindDefaults;
  /**
   * The picture under the map. Absent and null both mean none — read it only
   * through `underlayOf`. Optional so a doc built before the picture existed
   * (every test fixture) is still a doc; `loadDoc` always sets it.
   */
  underlay?: EditorUnderlay | null;
}

export function rectOf(item: Pick<EditorItem, 'xCm' | 'yCm' | 'widthCm' | 'depthCm'>): Rect {
  return { x: item.xCm, y: item.yCm, width: item.widthCm, depth: item.depthCm };
}

export function findItem(doc: EditorDoc, id: string): EditorItem | undefined {
  return doc.items.find((entry) => entry.id === id);
}

/** The picture under the map, or null: the one way to read `EditorDoc.underlay`. */
export function underlayOf(doc: Pick<EditorDoc, 'underlay'>): EditorUnderlay | null {
  return doc.underlay ?? null;
}

/** The same file lying the same way, calibrated from the same two points: field by field. */
export function sameUnderlay(a: EditorUnderlay | null, b: EditorUnderlay | null): boolean {
  if (a === null || b === null) return a === b;
  const ca = a.calibration;
  const cb = b.calibration;
  const sameCalibration = ca === null || cb === null
    ? ca === cb
    : ca.distanceCm === cb.distanceCm
      && ca.from[0] === cb.from[0] && ca.from[1] === cb.from[1]
      && ca.to[0] === cb.to[0] && ca.to[1] === cb.to[1];
  return sameCalibration
    && a.storageKey === b.storageKey && a.contentType === b.contentType
    && a.sizeBytes === b.sizeBytes && a.filename === b.filename
    && a.centreXCm === b.centreXCm && a.centreYCm === b.centreYCm
    && a.widthCm === b.widthCm && a.rotationTenths === b.rotationTenths;
}

/** A copy that shares no array with the one it came from: history and the save queue both keep ops. */
export function copyUnderlay(underlay: EditorUnderlay | null): EditorUnderlay | null {
  if (underlay === null) return null;
  const { calibration } = underlay;
  return {
    ...underlay,
    calibration: calibration === null ? null : {
      from: [calibration.from[0], calibration.from[1]],
      to: [calibration.to[0], calibration.to[1]],
      distanceCm: calibration.distanceCm,
    },
  };
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
