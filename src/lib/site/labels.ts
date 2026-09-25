import type { ShadeState } from './geometry';

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
