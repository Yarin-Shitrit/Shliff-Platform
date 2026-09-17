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
