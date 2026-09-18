/**
 * R6: a drawer is a URL. These are the only two param names the app uses for
 * one, and they live here so that no screen spells them by hand.
 *
 * Pure functions with no React and no `next/navigation`, so a Server Component
 * building a link and a client component handling `esc` call the same code.
 */
export const PEEK_PARAM = 'peek';
export const ACT_PARAM = 'act';

/** Both `URLSearchParams` and Next's `ReadonlyURLSearchParams` satisfy this. */
export type ReadableParams = Iterable<readonly [string, string]>;

function build(
  pathname: string,
  current: ReadableParams,
  mutate: (next: URLSearchParams) => void,
): string {
  const next = new URLSearchParams();
  for (const [key, value] of current) {
    if (key === PEEK_PARAM || key === ACT_PARAM) continue;
    next.append(key, value);
  }
  mutate(next);
  const query = next.toString();
  return query === '' ? pathname : `${pathname}?${query}`;
}

/** Opening a second record replaces the first; drawers never stack. */
export function openPeekHref(
  pathname: string, current: ReadableParams, id: string, act?: string,
): string {
  return build(pathname, current, (next) => {
    next.set(PEEK_PARAM, id);
    if (act !== undefined) next.set(ACT_PARAM, act);
  });
}

/**
 * Everything else survives — `season` above all (R5), plus the saved view, the
 * filters, the search and the sort. Closing a drawer never drops the lead back
 * into an unfiltered list.
 */
export function closePeekHref(pathname: string, current: ReadableParams): string {
  return build(pathname, current, () => {});
}

/**
 * A create drawer has no record to peek at, so it is `?act=<verb>` with no
 * `peek` — everything else survives exactly as it does for `openPeekHref` and
 * `closePeekHref`. Opening a create drawer over an already-open record drawer
 * replaces it rather than stacking both.
 */
export function openActHref(pathname: string, current: ReadableParams, act: string): string {
  return build(pathname, current, (next) => {
    next.set(ACT_PARAM, act);
  });
}
