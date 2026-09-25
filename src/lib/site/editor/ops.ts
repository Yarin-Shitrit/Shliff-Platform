import type { SiteItemKind, SiteLineKind, SiteLinePoint } from '@/db/schema/site';
import { isBlank } from '@/lib/text/normalize';
import type { KindDefaults, KindSize } from '../defaults';
import { MIN_SIDE_CM } from '../geometry';
import { DEFAULT_SHADE_INSET_CM, isSiteItemKind } from '../kinds';
import { endpointRefusal, isSiteLineKind, joins } from '../lines';
import { findItem, findLine, type EditorDoc, type EditorItem, type EditorLine } from './model';

/**
 * Every change the editor persists is one of seven ops (spec §6.2; the three
 * line ops came with `site_lines`). The client checks each op with these
 * refusals before it is queued; the server checks them again before it
 * writes (`plan.ts` `applySiteOps`). One set of rules, in one file, so the
 * two can never disagree.
 *
 * Refusals are English with a stable prefix, like every refusal in
 * `src/lib/site/`; `failure-messages.ts` turns each into Hebrew.
 */

export interface ItemPatch {
  label?: string;
  kind?: SiteItemKind;
  xCm?: number;
  yCm?: number;
  widthCm?: number;
  depthCm?: number;
  heightCm?: number | null;
  insetCm?: number | null;
  taskId?: string | null;
  notes?: string | null;
  locked?: boolean;
}

/** What may change on a line once it is drawn. Its kind may not: a pipe does not become a cable. */
export interface LinePatch {
  label?: string;
  fromId?: string;
  toId?: string;
  points?: SiteLinePoint[];
  notes?: string | null;
}

export type SiteOp =
  | { type: 'add'; item: EditorItem }
  | { type: 'update'; id: string; patch: ItemPatch }
  | { type: 'remove'; id: string }
  | { type: 'setKindDefault'; kind: SiteItemKind; size: KindSize | null }
  | { type: 'addLine'; line: EditorLine }
  | { type: 'updateLine'; id: string; patch: LinePatch }
  | { type: 'removeLine'; id: string };

/** The three ops about lines, told apart from the four about items. */
export function isLineOp(op: SiteOp): op is Extract<SiteOp, { type: 'addLine' | 'updateLine' | 'removeLine' }> {
  return op.type === 'addLine' || op.type === 'updateLine' || op.type === 'removeLine';
}

/** What `saveSiteChangesAction` answers (spec §6.4). */
export type SaveResult =
  | { ok: true; version: number }
  | { ok: false; reason: 'conflict'; version: number }
  | { ok: false; reason: 'refused'; error: string };

export const MAX_SIDE_CM = 50_000;
export const MAX_HEIGHT_CM = 2_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isSide(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_SIDE_CM && value <= MAX_SIDE_CM;
}

function isHeight(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_SIDE_CM && value <= MAX_HEIGHT_CM;
}

export function patchRefusal(patch: ItemPatch): string | null {
  if (patch.label !== undefined && isBlank(patch.label)) return 'an item must have a label';
  if (patch.kind !== undefined && !isSiteItemKind(patch.kind)) return `unknown item kind: ${String(patch.kind)}`;
  for (const side of [patch.widthCm, patch.depthCm]) {
    if (side !== undefined && !isSide(side)) {
      return 'an item side must be a whole number of centimetres between 10 and 50000';
    }
  }
  for (const coordinate of [patch.xCm, patch.yCm]) {
    // Negative is allowed: an item past the fence is outside, which the
    // screen reports, not impossible.
    if (coordinate !== undefined && !Number.isInteger(coordinate)) {
      return 'an item position must be a whole number of centimetres';
    }
  }
  if (patch.insetCm !== undefined && patch.insetCm !== null
    && (!Number.isInteger(patch.insetCm) || patch.insetCm < 0)) {
    return 'a shade inset must be a whole number of centimetres, zero or more';
  }
  if (patch.heightCm !== undefined && patch.heightCm !== null && !isHeight(patch.heightCm)) {
    return 'an item height must be a whole number of centimetres between 10 and 2000';
  }
  if (patch.locked !== undefined && typeof patch.locked !== 'boolean') return 'a lock must be true or false';
  return null;
}

export function newItemRefusal(entry: EditorItem): string | null {
  if (!UUID.test(entry.id)) return 'an item id must be a uuid';
  if (!Number.isInteger(entry.sort) || entry.sort < 0) {
    return 'an item sort must be a whole number, zero or more';
  }
  return patchRefusal({
    label: entry.label, kind: entry.kind, xCm: entry.xCm, yCm: entry.yCm,
    widthCm: entry.widthCm, depthCm: entry.depthCm, heightCm: entry.heightCm,
    insetCm: entry.insetCm, locked: entry.locked,
  });
}

export function kindSizeRefusal(size: KindSize): string | null {
  const insetOk = size.insetCm === null || (Number.isInteger(size.insetCm) && size.insetCm >= 0);
  return isSide(size.widthCm) && isSide(size.depthCm) && isHeight(size.heightCm) && insetOk
    ? null
    : 'a kind default must be whole centimetres: sides 10 to 50000, height 10 to 2000';
}

/** No more bends than a lead could ever place by hand; past this the op is a bug, not a route. */
export const MAX_LINE_POINTS = 200;

function isPoint(value: unknown): value is SiteLinePoint {
  return Array.isArray(value) && value.length === 2 && value.every((n) => Number.isInteger(n) && Math.abs(n) <= MAX_SIDE_CM);
}

export function linePatchRefusal(patch: LinePatch): string | null {
  if (patch.label !== undefined && isBlank(patch.label)) return 'a line must have a label';
  if (patch.points !== undefined) {
    if (!Array.isArray(patch.points) || patch.points.length > MAX_LINE_POINTS || !patch.points.every(isPoint)) {
      return 'a line bend must be a whole number of centimetres on the map';
    }
  }
  for (const end of [patch.fromId, patch.toId]) {
    if (end !== undefined && !UUID.test(end)) return 'a line end must be an item id';
  }
  return null;
}

export function newLineRefusal(line: EditorLine): string | null {
  if (!UUID.test(line.id)) return 'a line id must be a uuid';
  if (!isSiteLineKind(line.kind)) return `unknown line kind: ${String(line.kind)}`;
  if (!Number.isInteger(line.sort) || line.sort < 0) return 'a line sort must be a whole number, zero or more';
  return linePatchRefusal({ label: line.label, fromId: line.fromId, toId: line.toId, points: line.points });
}

/**
 * The one check of a line's ends that needs the map: both are items on it,
 * they differ, and each carries the utility (`lines.ts`). The client runs it
 * against the store; the server against the plan's rows.
 */
export function lineEndsRefusal(
  kind: SiteLineKind,
  from: Pick<EditorItem, 'id' | 'kind'> | undefined,
  to: Pick<EditorItem, 'id' | 'kind'> | undefined,
): string | null {
  // Not the `unknown site item` prefix: `failure-messages.ts` matches by prefix, and this one has its own sentence.
  if (from === undefined || to === undefined) return 'a line end is not an item on this map';
  return endpointRefusal(kind, from.kind, to.kind, from.id === to.id);
}

/** Re-kinding an item that a line hangs from, to a kind that utility does not reach: the line would run to nothing. */
export function rekindRefusal(nextKind: SiteItemKind, attached: readonly Pick<EditorLine, 'kind'>[]): string | null {
  return attached.some((line) => !joins(line.kind, nextKind))
    ? 'an item with a line attached keeps a kind that line can reach'
    : null;
}

export function opRefusal(op: SiteOp): string | null {
  switch (op.type) {
    case 'add': return newItemRefusal(op.item);
    case 'update': return patchRefusal(op.patch);
    case 'remove': return null;
    case 'setKindDefault':
      if (!isSiteItemKind(op.kind)) return `unknown item kind: ${String(op.kind)}`;
      return op.size === null ? null : kindSizeRefusal(op.size);
    case 'addLine': return newLineRefusal(op.line);
    case 'updateLine': return linePatchRefusal(op.patch);
    case 'removeLine': return null;
    default: return 'unknown operation';
  }
}

/** A line patch as the server stores it: label trimmed, blank notes as none, bends as fresh pairs. */
export function storedLinePatch(patch: LinePatch): LinePatch {
  const out: LinePatch = { ...patch };
  if (patch.label !== undefined) out.label = patch.label.trim();
  if (patch.notes !== undefined) out.notes = patch.notes === null || isBlank(patch.notes) ? null : patch.notes.trim();
  if (patch.points !== undefined) out.points = patch.points.map((p): SiteLinePoint => [p[0], p[1]]);
  return out;
}

/** Moving, resizing (height included), turning or re-kinding — what a lock forbids. Renaming, notes and task links are not. */
export const LOCKED_FIELDS: ReadonlyArray<keyof ItemPatch> = [
  'xCm', 'yCm', 'widthCm', 'depthCm', 'heightCm', 'kind', 'insetCm',
];

/** The one lock rule the client and `plan.ts`'s `applySiteOps` both run. */
export function lockRefusal(locked: boolean, patch: ItemPatch): string | null {
  return locked && patch.locked !== false && LOCKED_FIELDS.some((field) => patch[field] !== undefined)
    ? 'that item is locked'
    : null;
}

/**
 * The patch as the server stores it (`plan.ts`'s `patchSet` copies these
 * fields into the drizzle set): label trimmed; notes cleared to `null` when
 * `null` or blank, else trimmed; a net (`kind: 'shade'`) keeps or gains its
 * inset default; anything else never carries one — turning another kind into
 * a net, or a net into something else, resets the inset rather than leaving
 * a stale number. Every other field passes through unchanged.
 */
export function storedPatch(
  existing: Pick<EditorItem, 'kind' | 'insetCm'>, patch: ItemPatch,
): ItemPatch {
  const kind = patch.kind ?? existing.kind;
  const out: ItemPatch = { ...patch };
  if (patch.label !== undefined) out.label = patch.label.trim();
  if (patch.notes !== undefined) {
    out.notes = patch.notes === null || isBlank(patch.notes) ? null : patch.notes.trim();
  }
  if (kind === 'shade') {
    if (patch.insetCm !== undefined) out.insetCm = patch.insetCm ?? DEFAULT_SHADE_INSET_CM;
    else if (existing.insetCm === null) out.insetCm = DEFAULT_SHADE_INSET_CM;
  } else if (patch.kind !== undefined || patch.insetCm !== undefined) {
    out.insetCm = null;
  }
  return out;
}

/*
 * Applying, undoing and batching ops. The editor's store applies every edit
 * with `applyOps` the moment it is made (spec §6.1), records `invertOps` of it
 * as the undo, and the save queue sends `coalesceOps` of whatever is pending.
 * All three are pure: they never change the doc or the ops they are given,
 * because history and the queue both keep references to them.
 */

/** Only the fields a patch actually sets: `{ xCm: undefined }` sets nothing. */
function definedFields<P extends ItemPatch | LinePatch>(patch: P): P {
  const out = {} as P;
  for (const key of Object.keys(patch) as Array<keyof P>) {
    if (patch[key] !== undefined) out[key] = patch[key];
  }
  return out;
}

/** Two bend lists that draw the same line. */
export function samePoints(a: readonly SiteLinePoint[], b: readonly SiteLinePoint[]): boolean {
  return a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
}

function sameLineField(key: keyof LinePatch, a: LinePatch[keyof LinePatch], b: EditorLine[keyof LinePatch]): boolean {
  if (key === 'points') return samePoints(a as SiteLinePoint[], b as SiteLinePoint[]);
  return a === b;
}

function insertLineInOrder(lines: readonly EditorLine[], entry: EditorLine): EditorLine[] {
  const after = (a: EditorLine, b: EditorLine) => (a.sort !== b.sort ? a.sort - b.sort : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const at = lines.findIndex((other) => after(entry, other) < 0);
  return at === -1 ? [...lines, entry] : [...lines.slice(0, at), entry, ...lines.slice(at)];
}

function copyLine(line: EditorLine): EditorLine {
  return { ...line, points: line.points.map((p): SiteLinePoint => [p[0], p[1]]) };
}

/** The server's reading order (`listItems`: sort, then id), so an undone removal lands where it was. */
function drawOrder(a: EditorItem, b: EditorItem): number {
  if (a.sort !== b.sort) return a.sort - b.sort;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function insertInOrder(items: readonly EditorItem[], entry: EditorItem): EditorItem[] {
  const at = items.findIndex((other) => drawOrder(entry, other) < 0);
  return at === -1 ? [...items, entry] : [...items.slice(0, at), entry, ...items.slice(at)];
}

function withDefault(defaults: KindDefaults, kind: SiteItemKind, size: KindSize | null): KindDefaults {
  if (size !== null) return { ...defaults, [kind]: { ...size } };
  if (defaults[kind] === undefined) return defaults;
  const rest: KindDefaults = {};
  for (const key of Object.keys(defaults) as SiteItemKind[]) {
    if (key !== kind) rest[key] = defaults[key];
  }
  return rest;
}

/**
 * The doc after the ops, in order. An update or a remove naming an item that
 * is not there, or an add of an id that is, is skipped and handed back rather
 * than thrown: an undo can outlive its item — the other lead removed it, and
 * this lead reloaded after a conflict (spec §6.4) — and the right answer then
 * is to do the rest and say what was left out. An item the ops do not touch
 * stays the same object, and a doc they do not change comes back as itself.
 * Locks are not checked here: the commands skip locked items before any op
 * exists, and the server refuses what slips past them.
 */
export function applyOps(doc: EditorDoc, ops: readonly SiteOp[]): { doc: EditorDoc; skipped: SiteOp[] } {
  let items = doc.items;
  let lines = doc.lines;
  let defaults = doc.defaults;
  const skipped: SiteOp[] = [];
  for (const op of ops) {
    if (op.type === 'setKindDefault') {
      defaults = withDefault(defaults, op.kind, op.size);
      continue;
    }
    if (isLineOp(op)) {
      // A line's ends are not checked here, for the same reason locks are not: the
      // commands refuse a bad end before any op exists, and the server refuses what
      // slips past them. A line whose end has gone is drawn nowhere and measures nothing.
      const id = op.type === 'addLine' ? op.line.id : op.id;
      const index = lines.findIndex((entry) => entry.id === id);
      if (op.type === 'addLine') {
        if (index !== -1) { skipped.push(op); continue; }
        lines = insertLineInOrder(lines, copyLine(op.line));
      } else if (index === -1) {
        skipped.push(op);
      } else if (op.type === 'updateLine') {
        const next = lines.slice();
        next[index] = copyLine({ ...lines[index], ...definedFields(op.patch) });
        lines = next;
      } else {
        lines = [...lines.slice(0, index), ...lines.slice(index + 1)];
      }
      continue;
    }
    const id = op.type === 'add' ? op.item.id : op.id;
    const index = items.findIndex((entry) => entry.id === id);
    if (op.type === 'add') {
      if (index !== -1) { skipped.push(op); continue; }
      items = insertInOrder(items, { ...op.item });
    } else if (index === -1) {
      skipped.push(op);
    } else if (op.type === 'update') {
      const next = items.slice();
      next[index] = { ...items[index], ...definedFields(op.patch) };
      items = next;
    } else {
      items = [...items.slice(0, index), ...items.slice(index + 1)];
    }
  }
  const unchanged = items === doc.items && lines === doc.lines && defaults === doc.defaults;
  return { doc: unchanged ? doc : { ...doc, items, lines, defaults }, skipped };
}

/** What undoes one op against the doc it is about to be applied to; null when there is nothing to undo. */
function inverseOf(doc: EditorDoc, op: SiteOp): SiteOp | null {
  switch (op.type) {
    case 'add':
      return findItem(doc, op.item.id) ? null : { type: 'remove', id: op.item.id };
    case 'update': {
      const before = findItem(doc, op.id);
      if (!before) return null;
      const patch: ItemPatch = {};
      for (const key of Object.keys(op.patch) as Array<keyof ItemPatch>) {
        const value = op.patch[key];
        if (value !== undefined && value !== before[key]) (patch as Record<string, unknown>)[key] = before[key];
      }
      return Object.keys(patch).length === 0 ? null : { type: 'update', id: op.id, patch };
    }
    case 'remove': {
      const before = findItem(doc, op.id);
      return before ? { type: 'add', item: { ...before } } : null;
    }
    case 'setKindDefault': {
      const before = doc.defaults[op.kind];
      if (before === undefined && op.size === null) return null;
      return { type: 'setKindDefault', kind: op.kind, size: before === undefined ? null : { ...before } };
    }
    case 'addLine':
      return findLine(doc, op.line.id) ? null : { type: 'removeLine', id: op.line.id };
    case 'updateLine': {
      const before = findLine(doc, op.id);
      if (!before) return null;
      const patch: LinePatch = {};
      for (const key of Object.keys(op.patch) as Array<keyof LinePatch>) {
        const value = op.patch[key];
        if (value !== undefined && !sameLineField(key, value, before[key])) {
          (patch as Record<string, unknown>)[key] = key === 'points' ? before.points.map((p) => [p[0], p[1]]) : before[key];
        }
      }
      return Object.keys(patch).length === 0 ? null : { type: 'updateLine', id: op.id, patch };
    }
    case 'removeLine': {
      const before = findLine(doc, op.id);
      return before ? { type: 'addLine', line: copyLine(before) } : null;
    }
  }
}

/**
 * The ops that take `applyOps(doc, ops).doc` back to `doc`, last first. Each
 * op's inverse is read against the doc as it stood just before that op, so a
 * batch that moves one tent twice undoes to where the tent started. A skipped
 * op, or one that changed nothing, has nothing to undo.
 */
export function invertOps(doc: EditorDoc, ops: readonly SiteOp[]): SiteOp[] {
  const inverse: SiteOp[] = [];
  let current = doc;
  for (const op of ops) {
    const undo = inverseOf(current, op);
    const applied = applyOps(current, [op]);
    if (applied.skipped.length === 0 && undo !== null) inverse.push(undo);
    current = applied.doc;
  }
  return inverse.reverse();
}

function copyOf(op: SiteOp): SiteOp {
  switch (op.type) {
    case 'add': return { type: 'add', item: { ...op.item } };
    case 'update': return { type: 'update', id: op.id, patch: definedFields(op.patch) };
    case 'remove': return { type: 'remove', id: op.id };
    case 'setKindDefault': return { type: 'setKindDefault', kind: op.kind, size: op.size === null ? null : { ...op.size } };
    case 'addLine': return { type: 'addLine', line: copyLine(op.line) };
    case 'updateLine': return { type: 'updateLine', id: op.id, patch: storedLinePatch(definedFields(op.patch)) };
    case 'removeLine': return { type: 'removeLine', id: op.id };
  }
}

/**
 * Fewer ops that save the same thing (spec §6.3): updates to one item merge,
 * later fields winning; an add followed by updates becomes one add; an add
 * followed, however much later, by a remove sends nothing; a kind's default
 * keeps only its last size. Everything else keeps the order it came in,
 * which matters twice: an unlock must still reach the server before the
 * remove it allows, and a remove before an add of the same id (an undone
 * removal) must stay in that order.
 *
 * One more thing never merges: an update whose patch sets `locked: true`
 * never folds into an earlier update of the same id, and nothing folds into
 * one once it has — the server refuses a single patch that sets `locked:
 * true` alongside a locked field (`lockRefusal` above), so unlock, move,
 * relock has to reach the server as (at least) two writes, not one that
 * would lose the lead's edit in between.
 */
export function coalesceOps(ops: readonly SiteOp[]): SiteOp[] {
  const out: Array<SiteOp | null> = [];
  const lastForItem = new Map<string, number>();
  const lastForLine = new Map<string, number>();
  const lastForKind = new Map<SiteItemKind, number>();
  for (const op of ops) {
    if (op.type === 'setKindDefault') {
      const at = lastForKind.get(op.kind);
      if (at === undefined) {
        lastForKind.set(op.kind, out.length);
        out.push(copyOf(op));
      } else {
        out[at] = copyOf(op);
      }
      continue;
    }
    if (isLineOp(op)) {
      // The same three merges as an item's, and nothing about locks: a line has none.
      const id = op.type === 'addLine' ? op.line.id : op.id;
      const at = lastForLine.get(id);
      const held = at === undefined ? null : out[at];
      if (at !== undefined && held !== null) {
        if (op.type === 'updateLine' && held.type === 'addLine') {
          out[at] = { type: 'addLine', line: copyLine({ ...held.line, ...definedFields(op.patch) }) };
          continue;
        }
        if (op.type === 'updateLine' && held.type === 'updateLine') {
          out[at] = { type: 'updateLine', id, patch: storedLinePatch({ ...held.patch, ...definedFields(op.patch) }) };
          continue;
        }
        if (op.type === 'removeLine' && held.type === 'addLine') {
          out[at] = null;
          lastForLine.delete(id);
          continue;
        }
      }
      lastForLine.set(id, out.length);
      out.push(copyOf(op));
      continue;
    }
    const id = op.type === 'add' ? op.item.id : op.id;
    const at = lastForItem.get(id);
    const held = at === undefined ? null : out[at];
    if (at !== undefined && held !== null) {
      if (op.type === 'update' && held.type === 'add') {
        out[at] = { type: 'add', item: { ...held.item, ...definedFields(op.patch) } };
        continue;
      }
      if (
        op.type === 'update' && held.type === 'update'
        && op.patch.locked !== true && held.patch.locked !== true
      ) {
        out[at] = { type: 'update', id, patch: { ...held.patch, ...definedFields(op.patch) } };
        continue;
      }
      if (op.type === 'remove' && held.type === 'add') {
        out[at] = null;
        lastForItem.delete(id);
        continue;
      }
    }
    lastForItem.set(id, out.length);
    out.push(copyOf(op));
  }
  return out.filter((op): op is SiteOp => op !== null);
}
