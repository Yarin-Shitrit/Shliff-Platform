import {
  ACT_PARAM, PEEK_PARAM, closePeekHref, openActHref, openPeekHref,
} from '@/components/ui/drawer-url';

export const SITE_PATH = '/site';

/** `?act=plot`: the plot-size drawer — create the map, or resize its plot. */
export const PLOT_ACT = 'plot';
/** `?act=copy`: the drawer that copies another season's map into this one. */
export const COPY_ACT = 'copy';
/** `?peek=<id>&act=remove`: the confirmation over one item. */
export const REMOVE_ACT = 'remove';

export type RawParams = Record<string, string | string[] | undefined>;

export interface SiteQuery {
  season: string;
  /** The item a drawer is open over. */
  peek: string | null;
  plot: boolean;
  copy: boolean;
  removing: boolean;
  /**
   * `?editor=3d`: the bare 3D map instead of the board — temporary, so the
   * scene can be checked in a browser before the panels exist (plan 03,
   * Task 20). Task 26 makes the editor the page and removes the flag.
   */
  editor3d: boolean;
}

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export function parseSiteQuery(params: RawParams): SiteQuery {
  const peek = one(params[PEEK_PARAM]) || null;
  const act = one(params[ACT_PARAM]);
  return {
    season: one(params.season),
    peek,
    plot: act === PLOT_ACT,
    copy: act === COPY_ACT,
    removing: peek !== null && act === REMOVE_ACT,
    editor3d: one(params.editor) === '3d',
  };
}

/** Only the season survives from one URL to the next (R5); drawers are the kit's. */
function carried(params: RawParams): URLSearchParams {
  const next = new URLSearchParams();
  const season = one(params.season);
  if (season) next.set('season', season);
  return next;
}

/** The page itself, with any drawer closed. */
export function siteHref(params: RawParams): string {
  return closePeekHref(SITE_PATH, carried(params));
}

export function itemHref(params: RawParams, id: string): string {
  return openPeekHref(SITE_PATH, carried(params), id);
}

export function removeItemHref(params: RawParams, id: string): string {
  return openPeekHref(SITE_PATH, carried(params), id, REMOVE_ACT);
}

export function plotHref(params: RawParams): string {
  return openActHref(SITE_PATH, carried(params), PLOT_ACT);
}

export function copyHref(params: RawParams): string {
  return openActHref(SITE_PATH, carried(params), COPY_ACT);
}
