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
 * Centimetres, integers, like the schema. `group` is what the board colours
 * by; the tones are the platform's own tokens, never a chart series colour.
 */
export type SiteKindGroup = 'sleep' | 'living' | 'sanitation' | 'utility' | 'other';

export interface SiteKindPreset {
  label: string;
  group: SiteKindGroup;
  widthCm: number;
  depthCm: number;
}

export const SITE_KINDS: Record<SiteItemKind, SiteKindPreset> = {
  tent: { label: 'אוהל', group: 'sleep', widthCm: 300, depthCm: 300 },
  caravan: { label: 'קראוון', group: 'sleep', widthCm: 700, depthCm: 250 },
  shade: { label: 'רשת צל', group: 'sleep', widthCm: 800, depthCm: 800 },
  kitchen: { label: 'מטבח', group: 'living', widthCm: 400, depthCm: 300 },
  bar: { label: 'בר', group: 'living', widthCm: 300, depthCm: 100 },
  sofa: { label: 'ספה', group: 'living', widthCm: 200, depthCm: 90 },
  armchair: { label: 'כורסה', group: 'living', widthCm: 90, depthCm: 90 },
  table: { label: 'שולחן', group: 'living', widthCm: 180, depthCm: 80 },
  fire: { label: 'מדורה', group: 'living', widthCm: 150, depthCm: 150 },
  shower: { label: 'מקלחת', group: 'sanitation', widthCm: 100, depthCm: 100 },
  toilet: { label: 'תא שירותים', group: 'sanitation', widthCm: 100, depthCm: 100 },
  changing: { label: 'אזור הלבשה', group: 'sanitation', widthCm: 200, depthCm: 150 },
  fridge: { label: 'מקרר', group: 'utility', widthCm: 70, depthCm: 70 },
  generator: { label: 'גנרטור', group: 'utility', widthCm: 100, depthCm: 80 },
  water: { label: 'מיכל מי שתייה', group: 'utility', widthCm: 120, depthCm: 120 },
  greywater: { label: 'מים אפורים', group: 'utility', widthCm: 100, depthCm: 100 },
  boiler: { label: 'דוד', group: 'utility', widthCm: 60, depthCm: 60 },
  storage: { label: 'מחסן', group: 'utility', widthCm: 200, depthCm: 200 },
  other: { label: 'אחר', group: 'other', widthCm: 100, depthCm: 100 },
};

/** The palette's order: what is built first comes first. */
export const KIND_ORDER: readonly SiteItemKind[] = [
  'shade', 'tent', 'caravan',
  'kitchen', 'bar', 'sofa', 'armchair', 'table', 'fire',
  'shower', 'toilet', 'changing',
  'fridge', 'generator', 'water', 'greywater', 'boiler', 'storage',
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
