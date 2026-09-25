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
  /**
   * Shade nets only: the camp's rope angle for nets, whole degrees 20–80
   * (spec D9, D17). Null for every other kind, and for nets until the camp
   * sets one — no angle is ever assumed (D16).
   */
  ropeAngleDeg: number | null;
}

export type KindDefaults = Partial<Record<SiteItemKind, KindSize>>;

export function presetSize(kind: SiteItemKind): KindSize {
  const preset = SITE_KINDS[kind];
  return {
    widthCm: preset.widthCm,
    depthCm: preset.depthCm,
    heightCm: preset.heightCm,
    insetCm: kind === 'shade' ? DEFAULT_SHADE_INSET_CM : null,
    ropeAngleDeg: null,
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
