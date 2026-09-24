import type { SiteItemKind } from '@/db/schema/site';
import { DEFAULT_SHADE_INSET_CM, SITE_KINDS } from './kinds';

/**
 * The size a kind lands at: the camp's own (`site_kind_defaults`) when it has
 * one, else the preset in `kinds.ts`. Camp-wide, not per season (spec D4).
 */
export interface KindSize {
  widthCm: number;
  depthCm: number;
  heightCm: number;
  /** Shade nets only; null for every other kind. */
  insetCm: number | null;
}

export type KindDefaults = Partial<Record<SiteItemKind, KindSize>>;

export function presetSize(kind: SiteItemKind): KindSize {
  const preset = SITE_KINDS[kind];
  return {
    widthCm: preset.widthCm,
    depthCm: preset.depthCm,
    heightCm: preset.heightCm,
    insetCm: kind === 'shade' ? DEFAULT_SHADE_INSET_CM : null,
  };
}

export function effectiveSize(kind: SiteItemKind, defaults: KindDefaults): KindSize {
  return defaults[kind] ?? presetSize(kind);
}

/** Whether the library tile carries the "changed" dot. */
export function isCustomised(kind: SiteItemKind, defaults: KindDefaults): boolean {
  return defaults[kind] !== undefined;
}

/** An item's own height, else its kind's. Drawing and shadows only. */
export function itemHeight(
  item: { kind: SiteItemKind; heightCm: number | null }, defaults: KindDefaults,
): number {
  return item.heightCm ?? effectiveSize(item.kind, defaults).heightCm;
}
