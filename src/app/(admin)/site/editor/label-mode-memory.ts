import type { LabelMode } from './scene/scene-view';

/**
 * The labels style this browser chose last — the camp lead's answer to plan
 * 2026-09-26-site-label-modes' Q2: remembered per browser, so the map opens
 * the way this viewer left it. It is how a viewer looks at the map, not part
 * of the map, so it lives in `localStorage` and never in the plan.
 *
 * Like `unsaved-work.ts`, storage that refuses — a private window, blocked
 * site data — is no error: the map opens floating, as on a first visit, and
 * the choice lasts the page.
 */
const KEY = 'shliff.site.labels';
const MODES: ReadonlySet<string> = new Set<LabelMode>(['floating', 'none', 'printed']);

/** The kept style, or null when nothing is kept, what is kept is not a style, or storage is unavailable. */
export function readLabelMode(): LabelMode | null {
  try {
    const kept = window.localStorage.getItem(KEY);
    return kept !== null && MODES.has(kept) ? (kept as LabelMode) : null;
  } catch {
    return null;
  }
}

/** Keeps the style for the next visit; never throws. */
export function keepLabelMode(mode: LabelMode): void {
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // Storage refused: the choice lasts this page.
  }
}
