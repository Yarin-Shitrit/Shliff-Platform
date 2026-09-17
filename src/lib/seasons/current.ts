import type { AnyDb } from '@/lib/db-types';
import { listSeasons, type Season } from '@/lib/members/roster';
import { pickSeason } from '@/lib/seasons/pick';

export interface ResolvedSeason {
  /** Newest first, for the switcher's menu. */
  seasons: Season[];
  /** Null only when the camp has no seasons at all — camp-wide, no season in scope. */
  current: Season | null;
}

/**
 * The one helper every season-scoped page uses (R5).
 *
 * Before this, `/fees`, `/money` and `/tasks` each held their own copy of
 * `seasons.find(...) ?? seasons[0]` beside their own season strip, and
 * `/members` had neither. Those copies are deleted by the plan that rewrites
 * each page; nothing new may grow another.
 */
export async function resolveSeason(
  db: AnyDb, requested?: string,
): Promise<ResolvedSeason> {
  const seasons = await listSeasons(db);
  return { seasons, current: pickSeason(seasons, requested) };
}
