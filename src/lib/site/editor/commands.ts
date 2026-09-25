import type { SiteItemKind, SiteLineKind, SiteLinePoint } from '@/db/schema/site';
import { effectiveSize, itemHeight, type KindSize } from '../defaults';
import { turnAboutCentre, unionRect, wholeCm, type Rect } from '../geometry';
import { DEFAULT_SHADE_INSET_CM } from '../kinds';
import { centreOfItem, eligibleEnds, geometricMedian, splits } from '../lines';
import { findItem, findLine, linesAt, nextLabel, nextLineLabel, rectOf, type EditorDoc, type EditorItem, type EditorLine } from './model';
import { landingRule, nearestFreeSpot } from './placement';
import {
  lineEndsRefusal, lockRefusal, rekindRefusal, samePoints, storedLinePatch, storedPatch,
  type ItemPatch, type LinePatch, type SiteOp,
} from './ops';

/**
 * Every edit a lead can make, as a pure function from the doc to the ops that
 * make it (spec §6.2). The store applies the ops with `applyOps`, records
 * `invertOps` of them as the undo, and queues them for saving; nothing here
 * touches the doc itself.
 *
 * Three rules hold for every command:
 * - Nothing to do answers `[]`, so an edit that changes nothing is neither
 *   saved nor an undo step.
 * - A locked item is skipped by anything that moves, resizes, turns or
 *   removes it (spec §5). The lock is the lead's statement that the thing is
 *   where it goes; only unlocking changes that.
 * - An update carries only the fields that change, so two leads editing
 *   different fields of one tent never overwrite each other's field.
 */

type UpdateOp = Extract<SiteOp, { type: 'update' }>;

/** The items named, once each, in the order named. Ids that are gone are left out. */
function itemsOf(doc: EditorDoc, ids: readonly string[]): EditorItem[] {
  const seen = new Set<string>();
  const out: EditorItem[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const entry = findItem(doc, id);
    if (entry) out.push(entry);
  }
  return out;
}

function unlockedOf(doc: EditorDoc, ids: readonly string[]): EditorItem[] {
  return itemsOf(doc, ids).filter((entry) => !entry.locked);
}

/** An update holding only what differs from the item; null when nothing does. */
export function changedUpdate(entry: EditorItem, patch: ItemPatch): UpdateOp | null {
  const changed: ItemPatch = {};
  for (const key of Object.keys(patch) as Array<keyof ItemPatch>) {
    const value = patch[key];
    if (value !== undefined && value !== entry[key]) (changed as Record<string, unknown>)[key] = value;
  }
  return Object.keys(changed).length === 0 ? null : { type: 'update', id: entry.id, patch: changed };
}

function place(entry: EditorItem, rect: Rect): UpdateOp | null {
  return changedUpdate(entry, { xCm: rect.x, yCm: rect.y, widthCm: rect.width, depthCm: rect.depth });
}

function present(ops: ReadonlyArray<SiteOp | null>): SiteOp[] {
  return ops.filter((op): op is SiteOp => op !== null);
}

/** New sides about the same middle, in whole centimetres, never -0. */
function resizedAboutCentre(entry: EditorItem, widthCm: number, depthCm: number): Rect {
  return {
    x: wholeCm((entry.xCm * 2 + entry.widthCm - widthCm) / 2),
    y: wholeCm((entry.yCm * 2 + entry.depthCm - depthCm) / 2),
    width: widthCm,
    depth: depthCm,
  };
}

/** One past the highest `sort`: drawn on top of everything, as a new item on the map always has been. */
function nextSort(items: readonly EditorItem[]): number {
  return items.reduce((top, entry) => Math.max(top, entry.sort), -1) + 1;
}

export function moveOps(doc: EditorDoc, ids: readonly string[], dxCm: number, dyCm: number): SiteOp[] {
  const dx = wholeCm(dxCm);
  const dy = wholeCm(dyCm);
  if (dx === 0 && dy === 0) return [];
  return present(unlockedOf(doc, ids).map((entry) => changedUpdate(entry, { xCm: entry.xCm + dx, yCm: entry.yCm + dy })));
}

/** A handle drag or typed position and sides, for one item. */
export function setRectOps(
  doc: EditorDoc, id: string, rect: { xCm: number; yCm: number; widthCm: number; depthCm: number },
): SiteOp[] {
  const entry = findItem(doc, id);
  if (!entry || entry.locked) return [];
  return present([changedUpdate(entry, {
    xCm: wholeCm(rect.xCm), yCm: wholeCm(rect.yCm), widthCm: wholeCm(rect.widthCm), depthCm: wholeCm(rect.depthCm),
  })]);
}

/** A quarter turn each, about each item's own middle (spec D5). A square turns into itself: no op. */
export function turnOps(doc: EditorDoc, ids: readonly string[]): SiteOp[] {
  return present(unlockedOf(doc, ids).map((entry) => place(entry, turnAboutCentre(rectOf(entry)))));
}

/**
 * A new item of `kind` with its north-west corner at `at`, at the kind's
 * effective size (the camp's own default, else the preset). Its height is
 * the kind's (null); a net gets the kind's unshaded strip, or the standard
 * one, exactly as the server would give it (`applySiteOps`). A net follows
 * the camp's rope angle (null), as it follows its kind's height.
 */
export function addOps(
  doc: EditorDoc, kind: SiteItemKind, at: { xCm: number; yCm: number }, id: string,
): SiteOp[] {
  if (findItem(doc, id)) return [];
  const size = effectiveSize(kind, doc.defaults);
  return [{
    type: 'add',
    item: {
      id, kind, label: nextLabel(doc.items, kind),
      xCm: wholeCm(at.xCm), yCm: wholeCm(at.yCm), widthCm: size.widthCm, depthCm: size.depthCm,
      heightCm: null, insetCm: kind === 'shade' ? (size.insetCm ?? DEFAULT_SHADE_INSET_CM) : null, ropeAngleDeg: null,
      sort: nextSort(doc.items), taskId: null, notes: null, locked: false,
    },
  }];
}

/**
 * Removing an item takes its pipes and cables with it, each as its own op
 * before the item's, so an undo puts the item back first and then every line
 * that hung from it. The database would drop them anyway (the cascade in
 * `site.ts`); the explicit ops are what makes the removal undoable.
 */
export function removeOps(doc: EditorDoc, ids: readonly string[]): SiteOp[] {
  const going = unlockedOf(doc, ids);
  const lineIds = new Set<string>();
  const ops: SiteOp[] = [];
  for (const entry of going) {
    for (const line of linesAt(doc, entry.id)) {
      if (lineIds.has(line.id)) continue;
      lineIds.add(line.id);
      ops.push({ type: 'removeLine', id: line.id });
    }
  }
  for (const entry of going) ops.push({ type: 'remove', id: entry.id });
  return ops;
}

/**
 * Copies of the items, placed together beside the originals: east of them by
 * the group's width and a metre, else south, west, north, and when none of
 * those is clear, a metre east and south — on top of something, which the
 * overlap flag then says, rather than nowhere. Clear is `landingRule`'s 'ok'
 * (`placement.ts`): the copy's footprint inside the fence — a copied net
 * keeps its own angle — on nothing solid, and out of every net's rope band.
 * A locked item may be copied;
 * its copy is unlocked, because the lock was about where the original goes.
 * Each copy gets the kind's next label, so no two items share a name.
 */
export function duplicateOps(
  doc: EditorDoc, ids: readonly string[], newId: () => string,
): { ops: SiteOp[]; ids: string[] } {
  const sources = itemsOf(doc, ids);
  const group = unionRect(sources.map(rectOf));
  if (group === null) return { ops: [], ids: [] };
  const shifts: Array<[number, number]> = [
    [group.width + 100, 0], [0, group.depth + 100], [-(group.width + 100), 0], [0, -(group.depth + 100)],
  ];
  const lands = landingRule(doc);
  const clear = ([dx, dy]: [number, number]) => sources.every((source) => lands(
    source, { ...rectOf(source), x: source.xCm + dx, y: source.yCm + dy },
  ) === 'ok');
  const [dx, dy] = shifts.find(clear) ?? [100, 100];
  const made: EditorItem[] = [];
  let sort = nextSort(doc.items);
  for (const source of sources) {
    made.push({
      ...source,
      id: newId(),
      label: nextLabel([...doc.items, ...made], source.kind),
      xCm: source.xCm + dx,
      yCm: source.yCm + dy,
      sort,
      locked: false,
    });
    sort += 1;
  }
  return { ops: made.map((entry): SiteOp => ({ type: 'add', item: entry })), ids: made.map((entry) => entry.id) };
}

export function lockOps(doc: EditorDoc, ids: readonly string[], locked: boolean): SiteOp[] {
  return present(itemsOf(doc, ids).map((entry) => changedUpdate(entry, { locked })));
}

/**
 * A patch's position, sides and (non-null) height or inset rounded to whole
 * centimetres, so a typed 350.4 or 612.6 becomes 350 or 613 before it ever
 * reaches an op.
 */
function roundedPatch(patch: ItemPatch): ItemPatch {
  const out: ItemPatch = { ...patch };
  if (out.xCm !== undefined) out.xCm = wholeCm(out.xCm);
  if (out.yCm !== undefined) out.yCm = wholeCm(out.yCm);
  if (out.widthCm !== undefined) out.widthCm = wholeCm(out.widthCm);
  if (out.depthCm !== undefined) out.depthCm = wholeCm(out.depthCm);
  if (out.heightCm !== undefined && out.heightCm !== null) out.heightCm = wholeCm(out.heightCm);
  if (out.insetCm !== undefined && out.insetCm !== null) out.insetCm = wholeCm(out.insetCm);
  return out;
}

/**
 * Whatever the inspector typed for one item, built through `storedPatch` (the
 * same helper `plan.ts`'s `patchSet` uses), so the screen shows what gets
 * saved: a trimmed label, blank notes as none, and a net that always has an
 * unshaded strip while nothing else ever does — explicit in the op, so an
 * undo of a kind change restores the item's own inset, not the default.
 * Fields equal to the item's own are dropped first, so a form that sends its
 * unchanged position with a new name renames a locked tent. What is left may
 * not move, resize or re-kind a locked item unless the same patch unlocks it
 * — `lockRefusal`, the one rule the client and the server both run.
 */
export function patchOps(doc: EditorDoc, id: string, patch: ItemPatch): SiteOp[] {
  const entry = findItem(doc, id);
  if (!entry) return [];
  const op = changedUpdate(entry, storedPatch(entry, roundedPatch(patch)));
  if (op === null) return [];
  if (lockRefusal(entry.locked, op.patch) !== null) return [];
  // A fridge with a cable does not become a tent (`rekindRefusal`, the rule the server runs too).
  if (op.patch.kind !== undefined && rekindRefusal(op.patch.kind, linesAt(doc, id)) !== null) return [];
  return [op];
}

/* ── lines ──────────────────────────────────────────────────────────────── */

type UpdateLineOp = Extract<SiteOp, { type: 'updateLine' }>;

/** One past the highest `sort` among the lines. */
function nextLineSort(lines: readonly EditorLine[]): number {
  return lines.reduce((top, entry) => Math.max(top, entry.sort), -1) + 1;
}

/** An update holding only what differs from the line; null when nothing does. */
export function changedLineUpdate(entry: EditorLine, patch: LinePatch): UpdateLineOp | null {
  const changed: LinePatch = {};
  for (const key of Object.keys(patch) as Array<keyof LinePatch>) {
    const value = patch[key];
    if (value === undefined) continue;
    const same = key === 'points' ? samePoints(value as SiteLinePoint[], entry.points) : value === entry[key];
    if (!same) (changed as Record<string, unknown>)[key] = value;
  }
  return Object.keys(changed).length === 0 ? null : { type: 'updateLine', id: entry.id, patch: changed };
}

/**
 * A new pipe or cable from one item to another, straight, with the kind's
 * next label. Nothing when either end is missing, the two are one item, or
 * an end does not carry the utility (`lineEndsRefusal`, the rule the server
 * runs too) — the inspector offers only ends that pass, so a refusal here is
 * a race with another lead, not a lead's mistake.
 */
export function addLineOps(doc: EditorDoc, kind: SiteLineKind, fromId: string, toId: string, id: string): SiteOp[] {
  if (findLine(doc, id)) return [];
  const from = findItem(doc, fromId);
  const to = findItem(doc, toId);
  if (lineEndsRefusal(kind, from, to) !== null) return [];
  return [{
    type: 'addLine',
    line: {
      id, kind, label: nextLineLabel(doc.lines, kind), fromId, toId, points: [],
      sort: nextLineSort(doc.lines), notes: null,
    },
  }];
}

/**
 * One run from a source to a new splitter, and a run from the splitter to
 * each of two or more targets — the way a tank feeds two showers and a
 * sink. The splitter stands where the runs add up shortest: the geometric
 * median of the source and the targets (`lines.ts`), on the nearest free
 * grid spot inside the fence. It is an ordinary item afterwards, to drag.
 *
 * Nothing when the source cannot split this utility, fewer than two targets
 * are named, a target is not one a new run from the source could reach
 * (`eligibleEnds`), or no free spot exists — each a message for the editor
 * to give, never a splitter placed on top of something.
 */
export function splitOps(
  doc: EditorDoc, kind: SiteLineKind, sourceId: string, targetIds: readonly string[],
  ids: { splitter: string; lines: readonly string[] },
): { ops: SiteOp[]; splitterId: string | null } {
  const none = { ops: [], splitterId: null };
  const source = findItem(doc, sourceId);
  const targets = [...new Set(targetIds)].map((id) => findItem(doc, id)).filter((item): item is EditorItem => item !== undefined);
  if (source === undefined || !splits(kind, source.kind) || targets.length < 2 || targets.length !== new Set(targetIds).size) return none;
  const eligible = new Set(eligibleEnds(doc, sourceId, kind).map((item) => item.id));
  if (!targets.every((target) => eligible.has(target.id))) return none;
  if (ids.lines.length < targets.length + 1 || findItem(doc, ids.splitter) !== undefined) return none;

  const size = effectiveSize('splitter', doc.defaults);
  const median = geometricMedian([centreOfItem(source), ...targets.map(centreOfItem)]);
  const spot = nearestFreeSpot(doc, 'splitter', size, { xCm: median[0], yCm: median[1] });
  if (spot === null) return none;

  const splitter: EditorItem = {
    id: ids.splitter, kind: 'splitter', label: nextLabel(doc.items, 'splitter'),
    xCm: spot.xCm, yCm: spot.yCm, widthCm: size.widthCm, depthCm: size.depthCm,
    heightCm: null, insetCm: null, ropeAngleDeg: null, sort: nextSort(doc.items), taskId: null, notes: null, locked: false,
  };
  const made: EditorLine[] = [];
  let sort = nextLineSort(doc.lines);
  const run = (id: string, fromId: string, toId: string) => {
    made.push({ id, kind, label: nextLineLabel([...doc.lines, ...made], kind), fromId, toId, points: [], sort, notes: null });
    sort += 1;
  };
  run(ids.lines[0], sourceId, splitter.id);
  targets.forEach((target, index) => { run(ids.lines[index + 1], splitter.id, target.id); });
  return {
    ops: [{ type: 'add', item: splitter }, ...made.map((line): SiteOp => ({ type: 'addLine', line }))],
    splitterId: splitter.id,
  };
}

export function removeLineOps(doc: EditorDoc, ids: readonly string[]): SiteOp[] {
  const seen = new Set<string>();
  const ops: SiteOp[] = [];
  for (const id of ids) {
    if (seen.has(id) || !findLine(doc, id)) continue;
    seen.add(id);
    ops.push({ type: 'removeLine', id });
  }
  return ops;
}

/**
 * Whatever the line inspector typed: a name, the bends in whole centimetres,
 * notes, or a new end — which is checked like a new line's. Fields equal to
 * the line's own are dropped, so nothing is saved for a form that changed
 * nothing.
 */
export function patchLineOps(doc: EditorDoc, id: string, patch: LinePatch): SiteOp[] {
  const entry = findLine(doc, id);
  if (!entry) return [];
  const rounded: LinePatch = { ...patch };
  if (rounded.points !== undefined) rounded.points = rounded.points.map((p): SiteLinePoint => [wholeCm(p[0]), wholeCm(p[1])]);
  const op = changedLineUpdate(entry, storedLinePatch(rounded));
  if (op === null) return [];
  if (op.patch.fromId !== undefined || op.patch.toId !== undefined) {
    const from = findItem(doc, op.patch.fromId ?? entry.fromId);
    const to = findItem(doc, op.patch.toId ?? entry.toId);
    if (lineEndsRefusal(entry.kind, from, to) !== null) return [];
  }
  return [op];
}

/**
 * One kind's row in the several-items inspector (spec §10): each unlocked
 * item of that kind takes the sides it was given, about its own middle. A
 * height equal to the one the item already shows is not written, so an item
 * still on its kind's height stays on it ("ברירת מחדל").
 */
export function resizeKindOps(
  doc: EditorDoc, ids: readonly string[], kind: SiteItemKind,
  size: { widthCm?: number; depthCm?: number; heightCm?: number },
): SiteOp[] {
  return present(unlockedOf(doc, ids).filter((entry) => entry.kind === kind).map((entry) => {
    const widthCm = size.widthCm !== undefined ? wholeCm(size.widthCm) : entry.widthCm;
    const depthCm = size.depthCm !== undefined ? wholeCm(size.depthCm) : entry.depthCm;
    const rect = resizedAboutCentre(entry, widthCm, depthCm);
    const patch: ItemPatch = { xCm: rect.x, yCm: rect.y, widthCm: rect.width, depthCm: rect.depth };
    if (size.heightCm !== undefined) {
      const heightCm = wholeCm(size.heightCm);
      if (heightCm !== itemHeight(entry, doc.defaults)) patch.heightCm = heightCm;
    }
    return changedUpdate(entry, patch);
  }));
}

/** "Back to the default": the kind's effective size about the item's middle, its height the kind's again, a net's strip the kind's. */
export function resetSizeOps(doc: EditorDoc, ids: readonly string[]): SiteOp[] {
  return present(unlockedOf(doc, ids).map((entry) => {
    const size = effectiveSize(entry.kind, doc.defaults);
    const rect = resizedAboutCentre(entry, size.widthCm, size.depthCm);
    const patch: ItemPatch = { xCm: rect.x, yCm: rect.y, widthCm: rect.width, depthCm: rect.depth, heightCm: null };
    if (entry.kind === 'shade') patch.insetCm = size.insetCm ?? DEFAULT_SHADE_INSET_CM;
    return changedUpdate(entry, patch);
  }));
}

function sameSize(a: KindSize | null, b: KindSize | null): boolean {
  if (a === null || b === null) return a === b;
  return a.widthCm === b.widthCm && a.depthCm === b.depthCm && a.heightCm === b.heightCm && a.insetCm === b.insetCm
    && a.ropeAngleDeg === b.ropeAngleDeg;
}

/**
 * The camp's own size for a kind (spec D4); null goes back to the preset.
 * Sides and height are rounded to whole centimetres; a non-net kind never
 * carries an inset or a rope angle — the server stores null for one regardless of what was
 * passed in.
 */
export function setKindDefaultOps(doc: EditorDoc, kind: SiteItemKind, size: KindSize | null): SiteOp[] {
  const rounded: KindSize | null = size === null ? null : {
    widthCm: wholeCm(size.widthCm),
    depthCm: wholeCm(size.depthCm),
    heightCm: wholeCm(size.heightCm),
    insetCm: kind === 'shade' && size.insetCm !== null ? wholeCm(size.insetCm) : null,
    ropeAngleDeg: kind === 'shade' ? size.ropeAngleDeg : null,
  };
  if (sameSize(doc.defaults[kind] ?? null, rounded)) return [];
  return [{ type: 'setKindDefault', kind, size: rounded }];
}

export type Alignment = 'west' | 'centreX' | 'east' | 'north' | 'centreY' | 'south';

function aligned(entry: EditorItem, group: Rect, how: Alignment): ItemPatch {
  switch (how) {
    case 'west': return { xCm: group.x };
    case 'east': return { xCm: group.x + group.width - entry.widthCm };
    case 'centreX': return { xCm: wholeCm((group.x * 2 + group.width - entry.widthCm) / 2) };
    case 'north': return { yCm: group.y };
    case 'south': return { yCm: group.y + group.depth - entry.depthCm };
    case 'centreY': return { yCm: wholeCm((group.y * 2 + group.depth - entry.depthCm) / 2) };
  }
}

/** Lines up two or more unlocked items on an edge or middle of the box around them. */
export function alignOps(doc: EditorDoc, ids: readonly string[], how: Alignment): SiteOp[] {
  const movable = unlockedOf(doc, ids);
  const group = unionRect(movable.map(rectOf));
  if (movable.length < 2 || group === null) return [];
  return present(movable.map((entry) => changedUpdate(entry, aligned(entry, group, how))));
}

/**
 * Equal gaps between three or more unlocked items along one axis. The first
 * and the last, by their middles, stay where they are; the ones between move.
 */
export function distributeOps(doc: EditorDoc, ids: readonly string[], axis: 'x' | 'y'): SiteOp[] {
  const movable = unlockedOf(doc, ids);
  if (movable.length < 3) return [];
  const start = (entry: EditorItem) => (axis === 'x' ? entry.xCm : entry.yCm);
  const side = (entry: EditorItem) => (axis === 'x' ? entry.widthCm : entry.depthCm);
  const sorted = [...movable].sort((a, b) => (start(a) * 2 + side(a)) - (start(b) * 2 + side(b)));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const inner = sorted.slice(1, -1);
  const taken = inner.reduce((sum, entry) => sum + side(entry), 0);
  const gap = (start(last) - (start(first) + side(first)) - taken) / (sorted.length - 1);
  let cursor = start(first) + side(first) + gap;
  const ops: Array<SiteOp | null> = [];
  for (const entry of inner) {
    const at = wholeCm(cursor);
    ops.push(changedUpdate(entry, axis === 'x' ? { xCm: at } : { yCm: at }));
    cursor += side(entry) + gap;
  }
  return present(ops);
}

/**
 * Two or more unlocked items in one row, west to east, from the north-west
 * corner of the box around them, `gapCm` apart. The order is the one they
 * already stand in — west first, then north first — so a row keeps its
 * sequence.
 */
export function rowOps(doc: EditorDoc, ids: readonly string[], gapCm: number): SiteOp[] {
  const movable = unlockedOf(doc, ids);
  const group = unionRect(movable.map(rectOf));
  if (movable.length < 2 || group === null) return [];
  const gap = wholeCm(gapCm);
  const sorted = [...movable].sort((a, b) => a.xCm - b.xCm || a.yCm - b.yCm);
  let cursor = group.x;
  const ops: Array<SiteOp | null> = [];
  for (const entry of sorted) {
    ops.push(changedUpdate(entry, { xCm: cursor, yCm: group.y }));
    cursor += entry.widthCm + gap;
  }
  return present(ops);
}

/**
 * One kind's sizes across a selection, for the several-items inspector: a
 * number where every item of the kind agrees, null where they differ, which
 * the inspector shows as "מעורב" rather than inventing a number (spec §13).
 * Locked items count: they are in the selection and on screen. Heights are
 * the ones the items show, their own or their kind's.
 */
export function uniformSize(
  doc: EditorDoc, ids: readonly string[], kind: SiteItemKind,
): { widthCm: number | null; depthCm: number | null; heightCm: number | null } {
  const ofKind = itemsOf(doc, ids).filter((entry) => entry.kind === kind);
  const agreed = (values: number[]): number | null => (
    values.length > 0 && values.every((value) => value === values[0]) ? values[0] : null
  );
  return {
    widthCm: agreed(ofKind.map((entry) => entry.widthCm)),
    depthCm: agreed(ofKind.map((entry) => entry.depthCm)),
    heightCm: agreed(ofKind.map((entry) => itemHeight(entry, doc.defaults))),
  };
}
