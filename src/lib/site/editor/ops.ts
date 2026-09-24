import type { SiteItemKind } from '@/db/schema/site';
import type { KindSize } from '../defaults';
import { MIN_SIDE_CM } from '../geometry';
import { isSiteItemKind } from '../kinds';
import type { EditorItem } from './model';

/**
 * Every change the editor persists is one of four ops (spec §6.2). The client
 * checks each op with these refusals before it is queued; the server checks
 * them again before it writes (`plan.ts` `applySiteOps`). One set of rules,
 * in one file, so the two can never disagree.
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

export type SiteOp =
  | { type: 'add'; item: EditorItem }
  | { type: 'update'; id: string; patch: ItemPatch }
  | { type: 'remove'; id: string }
  | { type: 'setKindDefault'; kind: SiteItemKind; size: KindSize | null };

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
  if (patch.label !== undefined && patch.label.trim() === '') return 'an item must have a label';
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

export function opRefusal(op: SiteOp): string | null {
  switch (op.type) {
    case 'add': return newItemRefusal(op.item);
    case 'update': return patchRefusal(op.patch);
    case 'remove': return null;
    case 'setKindDefault':
      if (!isSiteItemKind(op.kind)) return `unknown item kind: ${String(op.kind)}`;
      return op.size === null ? null : kindSizeRefusal(op.size);
    default: return 'unknown operation';
  }
}
