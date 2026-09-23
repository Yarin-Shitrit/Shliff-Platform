import type { Handle, ShadeState } from './geometry';

/** The eight resize handles, named for a reader who cannot see them. */
export const HANDLE_LABELS: Record<Handle, string> = {
  n: 'שינוי גודל מלמעלה',
  s: 'שינוי גודל מלמטה',
  e: 'שינוי גודל מימין',
  w: 'שינוי גודל משמאל',
  ne: 'שינוי גודל מהפינה הימנית העליונה',
  nw: 'שינוי גודל מהפינה השמאלית העליונה',
  se: 'שינוי גודל מהפינה הימנית התחתונה',
  sw: 'שינוי גודל מהפינה השמאלית התחתונה',
};

export type SiteState = 'inside' | 'outside' | 'overlapping';

/** R3: the word carries the meaning; the tone only decorates it. */
export const SITE_STATE_LABELS: Record<SiteState, string> = {
  inside: 'במגרש',
  outside: 'מחוץ למגרש',
  overlapping: 'חופף',
};

export const SITE_STATE_TONES: Record<SiteState, 'ok' | 'warn' | 'bad'> = {
  inside: 'ok',
  outside: 'bad',
  overlapping: 'warn',
};

export const SHADE_STATE_LABELS: Record<ShadeState, string> = {
  shaded: 'בצל',
  partly: 'חלקית בצל',
  unshaded: 'ללא צל',
};

export const SHADE_STATE_TONES: Record<ShadeState, 'ok' | 'warn' | 'neutral'> = {
  shaded: 'ok',
  partly: 'warn',
  unshaded: 'neutral',
};
