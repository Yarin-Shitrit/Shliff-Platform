import type { SiteItemKind } from '@/db/schema/site';

/**
 * The palette: what a lead can drop on the map, with the size it lands at.
 *
 * The defaults are the sketches' — an 8 × 8 shade lounge, a 3 × 3 tent, a
 * 7 × 2.5 caravan — and every one of them is a starting point, not a rule:
 * the size is editable on every item after it lands, by dragging a handle or
 * by typing centimetres. What this table fixes is only that a new tent is
 * tent-sized rather than a 1 × 1 square somebody has to stretch every time.
 *
 * Centimetres, integers, like the schema. `group` is what the map colours
 * by — the scene's own palette (`editor/scene/palette.ts`), which the panels
 * take as `--group-*` custom properties.
 */
export type SiteKindGroup = 'sleep' | 'living' | 'sanitation' | 'utility' | 'other';

/** How the scene draws a kind (`scene/meshes.ts`). */
export type SiteKindShape = 'box' | 'sofa' | 'tent' | 'cylinder' | 'fire' | 'net';

export interface SiteKindPreset {
  label: string;
  /** For a grouped label: "4 תאי שירותים". */
  plural: string;
  group: SiteKindGroup;
  shape: SiteKindShape;
  widthCm: number;
  depthCm: number;
  /** Drawn and shadowed only. A net's height is the height of its cloth. */
  heightCm: number;
}

export const SITE_KINDS: Record<SiteItemKind, SiteKindPreset> = {
  tent: { label: 'אוהל', plural: 'אוהלים', group: 'sleep', shape: 'tent', widthCm: 300, depthCm: 300, heightCm: 200 },
  caravan: { label: 'קראוון', plural: 'קראוונים', group: 'sleep', shape: 'box', widthCm: 700, depthCm: 250, heightCm: 270 },
  shade: { label: 'רשת צל', plural: 'רשתות צל', group: 'sleep', shape: 'net', widthCm: 800, depthCm: 800, heightCm: 300 },
  kitchen: { label: 'מטבח', plural: 'מטבחים', group: 'living', shape: 'box', widthCm: 400, depthCm: 300, heightCm: 230 },
  bar: { label: 'בר', plural: 'ברים', group: 'living', shape: 'box', widthCm: 300, depthCm: 100, heightCm: 110 },
  sofa: { label: 'ספה', plural: 'ספות', group: 'living', shape: 'sofa', widthCm: 200, depthCm: 90, heightCm: 80 },
  armchair: { label: 'כורסה', plural: 'כורסאות', group: 'living', shape: 'sofa', widthCm: 90, depthCm: 90, heightCm: 80 },
  table: { label: 'שולחן', plural: 'שולחנות', group: 'living', shape: 'box', widthCm: 180, depthCm: 80, heightCm: 75 },
  fire: { label: 'מדורה', plural: 'מדורות', group: 'living', shape: 'fire', widthCm: 150, depthCm: 150, heightCm: 35 },
  shower: { label: 'מקלחת', plural: 'מקלחות', group: 'sanitation', shape: 'box', widthCm: 100, depthCm: 100, heightCm: 210 },
  toilet: { label: 'תא שירותים', plural: 'תאי שירותים', group: 'sanitation', shape: 'box', widthCm: 100, depthCm: 100, heightCm: 220 },
  changing: { label: 'אזור הלבשה', plural: 'אזורי הלבשה', group: 'sanitation', shape: 'box', widthCm: 200, depthCm: 150, heightCm: 200 },
  // A camp sink: a basin on a stand, the width of a person. Where a water pipe ends (`lines.ts`).
  sink: { label: 'כיור', plural: 'כיורים', group: 'sanitation', shape: 'box', widthCm: 100, depthCm: 50, heightCm: 90 },
  fridge: { label: 'מקרר', plural: 'מקררים', group: 'utility', shape: 'box', widthCm: 70, depthCm: 70, heightCm: 170 },
  generator: { label: 'גנרטור', plural: 'גנרטורים', group: 'utility', shape: 'box', widthCm: 100, depthCm: 80, heightCm: 100 },
  water: { label: 'מיכל מי שתייה', plural: 'מיכלי מי שתייה', group: 'utility', shape: 'cylinder', widthCm: 120, depthCm: 120, heightCm: 130 },
  greywater: { label: 'מים אפורים', plural: 'מיכלי מים אפורים', group: 'utility', shape: 'cylinder', widthCm: 100, depthCm: 100, heightCm: 100 },
  boiler: { label: 'דוד', plural: 'דודים', group: 'utility', shape: 'cylinder', widthCm: 60, depthCm: 60, heightCm: 60 },
  storage: { label: 'מחסן', plural: 'מחסנים', group: 'utility', shape: 'box', widthCm: 200, depthCm: 200, heightCm: 220 },
  // A light on a pole: a small footprint, tall. Where a power cable ends (`lines.ts`).
  light: { label: 'תאורה', plural: 'נקודות תאורה', group: 'utility', shape: 'box', widthCm: 40, depthCm: 40, heightCm: 250 },
  other: { label: 'אחר', plural: 'פריטים', group: 'other', shape: 'box', widthCm: 100, depthCm: 100, heightCm: 100 },
};

/** The palette's order: what is built first comes first. */
export const KIND_ORDER: readonly SiteItemKind[] = [
  'shade', 'tent', 'caravan',
  'kitchen', 'bar', 'sofa', 'armchair', 'table', 'fire',
  'shower', 'toilet', 'changing', 'sink',
  'fridge', 'generator', 'water', 'greywater', 'boiler', 'storage', 'light',
  'other',
];

export const KIND_GROUP_ORDER: readonly SiteKindGroup[] = [
  'sleep', 'living', 'sanitation', 'utility', 'other',
];

export const KIND_GROUP_LABELS: Record<SiteKindGroup, string> = {
  sleep: 'לינה וצל',
  living: 'מגורים',
  sanitation: 'סניטציה',
  utility: 'תשתית',
  other: 'אחר',
};

/**
 * The strip a shade net leaves unshaded on every side, by default. A net of
 * m × n shades (m − 1) × (n − 1): the poles stand at the edge and the fabric
 * sags, so half a metre on each side is sun. Editable per net, because a
 * tight net over tall poles does better than that and a slack one worse.
 */
export const DEFAULT_SHADE_INSET_CM = 50;

export function isSiteItemKind(value: string): value is SiteItemKind {
  return Object.prototype.hasOwnProperty.call(SITE_KINDS, value);
}
