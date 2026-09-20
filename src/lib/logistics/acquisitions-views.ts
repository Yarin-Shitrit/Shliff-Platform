import { ACT_PARAM, PEEK_PARAM } from '@/components/ui/drawer-url';
import type { AcquisitionStatus, LogisticsCategory } from '@/db/schema/logistics';

/**
 * The acquisitions screen's URL, and the only place it is spelled.
 *
 * The difference from `warehouse-views.ts` is the season. The warehouse is
 * camp-wide and says so; what the camp still needs is a fact about one year,
 * so `season` is carried by every link here — a filter, a sort, and both
 * drawers opening and closing (R5). Losing it on any one of them would move
 * a lead to a different year without saying so, which is the failure the
 * whole season-scoping rule exists to prevent.
 */

export const ACQUISITIONS_PATH = '/logistics/acquisitions';

/** `all` plus the four statuses: the tabs the artboard draws, in its order. */
export const ACQUISITION_VIEWS = [
  'all', 'to_search', 'in_review', 'ordered', 'arrived',
] as const;
export type AcquisitionView = (typeof ACQUISITION_VIEWS)[number];

export const ACQUISITION_SORTS = [
  'status', 'name', 'category', 'estimate', 'actual', 'assignee',
] as const;
export type AcquisitionSort = (typeof ACQUISITION_SORTS)[number];

/** Adding a row: a drawer with no record behind it (§5 A3). */
export const NEW_ACQUISITION_ACT = 'acquisition';

/**
 * The arrival decision. Unlike the create verb it needs a record, because the
 * question it asks — where did this go, and in what state — is about one
 * thing that arrived. `?act=arrival` with no `?peek=` names nothing to
 * receive, and is read as no drawer at all rather than as a blank form.
 */
export const ARRIVAL_ACT = 'arrival';

const CATEGORIES: readonly LogisticsCategory[] = [
  'kitchen', 'sanitation', 'living', 'build', 'general',
];

export interface AcquisitionQuery {
  /** Empty means "the page picks", which `resolveSeason` does. */
  season: string;
  view: AcquisitionView;
  q: string;
  category: LogisticsCategory | null;
  sort: AcquisitionSort;
  dir: 'asc' | 'desc';
  peek: string | null;
  creating: boolean;
  arriving: boolean;
}

export type RawParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** The status a view narrows to; `all` narrows to nothing. */
export function statusOf(view: AcquisitionView): AcquisitionStatus | null {
  return view === 'all' ? null : view;
}

/** Never throws: every param here can arrive mangled from a pasted link. */
export function parseAcquisitionQuery(params: RawParams): AcquisitionQuery {
  const rawView = one(params.view) as AcquisitionView;
  const rawSort = one(params.sort) as AcquisitionSort;
  const rawCat = one(params.cat) as LogisticsCategory;

  const peek = one(params[PEEK_PARAM]) || null;
  const act = one(params[ACT_PARAM]);

  return {
    season: one(params.season),
    view: ACQUISITION_VIEWS.includes(rawView) ? rawView : 'all',
    q: one(params.q).trim(),
    category: CATEGORIES.includes(rawCat) ? rawCat : null,
    // Status first: this screen is read to find out what still has to happen,
    // not for an alphabetical list of things the camp wants.
    sort: ACQUISITION_SORTS.includes(rawSort) ? rawSort : 'status',
    dir: one(params.dir) === 'desc' ? 'desc' : 'asc',
    peek,
    creating: peek === null && act === NEW_ACQUISITION_ACT,
    arriving: peek !== null && act === ARRIVAL_ACT,
  };
}

/** `season` leads, because it is the one that must never be dropped. */
const KEYS = ['season', 'view', 'q', 'cat', 'sort', 'dir'] as const;
type PatchKey = (typeof KEYS)[number] | typeof PEEK_PARAM | typeof ACT_PARAM;

/**
 * One param changed, the rest preserved, both drawer params dropped unless
 * the patch names them — the peeked row may not survive the new filter, and
 * a drawer standing over a row that is no longer listed is a dead end.
 */
export function acquisitionsHref(
  params: RawParams,
  patch: Partial<Record<PatchKey, string | null>>,
): string {
  const next = new URLSearchParams();
  for (const key of KEYS) {
    const value = one(params[key]);
    if (value) next.set(key, value);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
  }

  const qs = next.toString();
  return qs ? `${ACQUISITIONS_PATH}?${qs}` : ACQUISITIONS_PATH;
}

/** The drawer over one row. */
export function acquisitionHref(params: RawParams, id: string): string {
  return acquisitionsHref(params, { [PEEK_PARAM]: id });
}

/** The arrival decision over one row: the record and the verb together. */
export function arrivalHref(params: RawParams, id: string): string {
  return acquisitionsHref(params, { [PEEK_PARAM]: id, [ACT_PARAM]: ARRIVAL_ACT });
}

export function newAcquisitionHref(params: RawParams): string {
  return acquisitionsHref(params, { [ACT_PARAM]: NEW_ACQUISITION_ACT });
}

/** Clicking the active column reverses it rather than re-applying it. */
export function acquisitionSortHref(params: RawParams, sort: AcquisitionSort): string {
  const active = (one(params.sort) || 'status') === sort;
  const dir = active && one(params.dir) !== 'desc' ? 'desc' : 'asc';
  return acquisitionsHref(params, { sort, dir });
}
