import { openActHref, type ReadableParams } from '@/components/ui/drawer-url';

/**
 * Choosing a season rewrites `?season=` on the route you are standing on
 * (B4). It never navigates somewhere else: a lead comparing two years wants
 * the same table, not the home page.
 *
 * `peek` is dropped on purpose. A drawer is a URL (R6), but the record it
 * names belongs to the season being left, and carrying it across would open
 * a drawer onto a row the new season may not contain.
 */
export function seasonHref(pathname: string, search: string, seasonId: string): string {
  const params = new URLSearchParams(search);
  params.delete('peek');
  params.set('season', seasonId);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** The `act` that opens `SeasonDateDrawer`. Spelled here and nowhere else. */
export const SEASON_DATE_ACT = 'season-date';

/**
 * Opens the drawer that sets the gate date of the season `?season=` names,
 * on the route you are standing on — the same shape as `?act=season` (R6: an
 * `act` with no `peek`). The drawer is rendered by the rail, so this link
 * works from any admin page, and a page that shows a figure derived from the
 * gate date can link to what changes it.
 *
 * `?season=` survives, and it is the whole of how the drawer knows which
 * season to edit: it resolves the param with the same `pickSeason` the page
 * behind it used, so the two cannot disagree.
 */
export function seasonDateHref(pathname: string, current: ReadableParams): string {
  return openActHref(pathname, current, SEASON_DATE_ACT);
}
