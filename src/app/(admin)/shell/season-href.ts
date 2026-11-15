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

/**
 * A link that leaves the route you are standing on keeps the season you
 * chose. The year changes when somebody picks one in the switcher, and at no
 * other time: before this, every rail and tab-bar link was a bare path, so
 * one click on אנשים silently put the reader back on the newest season.
 *
 * `season` is the raw `?season=` of the current URL, carried verbatim — the
 * page it lands on resolves it with the same `pickSeason` as everything else.
 * With none in the URL the link stays bare, so nothing is invented. A link
 * that already names a season (a search hit for a row in another year) keeps
 * its own. The anchor stays last: `/money#budget` → `/money?season=…#budget`.
 */
export function carrySeason(href: string, season: string | null | undefined): string {
  if (!season) return href;
  const hashAt = href.indexOf('#');
  const hash = hashAt === -1 ? '' : href.slice(hashAt);
  const rest = hashAt === -1 ? href : href.slice(0, hashAt);
  const queryAt = rest.indexOf('?');
  const path = queryAt === -1 ? rest : rest.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? '' : rest.slice(queryAt + 1));
  if (params.has('season')) return href;
  params.set('season', season);
  return `${path}?${params.toString()}${hash}`;
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
