/**
 * Which season a `?season=` value means (R5).
 *
 * Deliberately pure and import-free: the sidebar's switcher is a Client
 * Component and cannot pull the Drizzle schema into the browser, and the
 * server's `resolveSeason` must apply exactly the same rule. One rule, two
 * callers — the chrome and the page can never name different seasons.
 *
 * `seasons` is expected in `listSeasons` order (year descending), so
 * element zero is the newest and is the fallback. An id that names no
 * season falls back rather than refusing: a stale link someone pasted into
 * WhatsApp should still open a page.
 */
export function pickSeason<T extends { id: string }>(
  seasons: readonly T[], requested: string | null | undefined,
): T | null {
  if (requested) {
    const asked = seasons.find((season) => season.id === requested);
    if (asked) return asked;
  }
  return seasons[0] ?? null;
}
