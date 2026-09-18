import { normalizeHebrew } from '@/lib/text/normalize';
import {
  ACT_PARAM, PEEK_PARAM, closePeekHref, openPeekHref,
} from '@/components/ui/drawer-url';
import type { DuesState, PersonListRow } from './people-list';

export const PEOPLE_VIEWS = ['all', 'roster', 'unpaid', 'new', 'leads', 'lapsed'] as const;
export type PeopleView = (typeof PEOPLE_VIEWS)[number];

export const PEOPLE_SORTS = ['name', 'balance', 'tasks', 'activity'] as const;
export type PeopleSort = (typeof PEOPLE_SORTS)[number];

const DUES_STATES: readonly DuesState[] = [
  'paid', 'offset', 'partial', 'unpaid', 'exempt', 'none',
];

/** The one screen every drawer on this list opens over. */
export const PEOPLE_PATH = '/members';

/**
 * The second id a merge needs, which neither of A3's two drawer shapes carries.
 *
 * A3 rules that an action drawer is `?peek=<id>&act=<verb>` and that merge —
 * alone among the verbs — needs two records, so the one being folded away stays
 * in `peek` and the survivor is named here. The kit owns `peek` and `act`; this
 * module owns `with`, and every href on this screen is built by the four
 * functions at the bottom of this file so that no component spells any of them.
 */
export const MERGE_WITH_PARAM = 'with';

export interface PeopleQuery {
  view: PeopleView;
  q: string;
  dues: DuesState | null;
  sort: PeopleSort;
  dir: 'asc' | 'desc';
  /** The record a drawer is open over, action drawers included. */
  peek: string | null;
  /** The action verb, when the drawer is doing something rather than showing. */
  act: string | null;
  /** `[absorbed, survivor]`, only when `act` is `merge` and both ids are real. */
  merge: [string, string] | null;
}

export type RawParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * Never throws and never 404s. Every one of these params can arrive truncated
 * or mangled from a link someone pasted into a chat, and the right answer to
 * that is the default view, not an error page.
 */
export function parsePeopleQuery(params: RawParams, hasSeason: boolean): PeopleQuery {
  const rawView = one(params.view) as PeopleView;
  const rawSort = one(params.sort) as PeopleSort;
  const rawDues = one(params.dues) as DuesState;

  const peek = one(params[PEEK_PARAM]) || null;
  const act = one(params[ACT_PARAM]) || null;
  const survivor = one(params[MERGE_WITH_PARAM]) || null;

  return {
    view: PEOPLE_VIEWS.includes(rawView) ? rawView : (hasSeason ? 'roster' : 'all'),
    q: one(params.q).trim(),
    dues: DUES_STATES.includes(rawDues) ? rawDues : null,
    sort: PEOPLE_SORTS.includes(rawSort) ? rawSort : 'name',
    dir: one(params.dir) === 'desc' ? 'desc' : 'asc',
    peek,
    act,
    /*
     * The verb is required, not inferred from the two ids being present: a
     * `with` left behind by a half-edited URL must not silently open a screen
     * that is one click away from an irreversible action.
     */
    merge: act === 'merge' && peek !== null && survivor !== null && peek !== survivor
      ? [peek, survivor]
      : null,
  };
}

export function matchesView(row: PersonListRow, view: PeopleView): boolean {
  switch (view) {
    case 'all': return true;
    case 'roster': return row.onScopeSeason;
    /*
     * `none` is deliberately not here. Someone the camp has never billed has
     * not failed to pay, and a count that said otherwise would read as an
     * accusation on the tab strip.
     */
    case 'unpaid':
      return row.onScopeSeason && row.dues !== null
        && (row.dues.state === 'unpaid' || row.dues.state === 'partial');
    case 'new': return row.newThisSeason;
    case 'leads': return row.role === 'lead';
    case 'lapsed': return row.lapsed;
  }
}

function matchesSearch(row: PersonListRow, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  if (normalizeHebrew(row.displayName).includes(normalizedQuery)) return true;
  return row.aliases.some((alias) => normalizeHebrew(alias).includes(normalizedQuery));
}

/** Total, so the order never changes between two renders of the same data:
 *  every comparison falls through to the name. */
function compare(a: PersonListRow, b: PersonListRow, sort: PeopleSort): number {
  switch (sort) {
    case 'balance': return a.outstandingAgorot - b.outstandingAgorot;
    case 'tasks': return a.taskCount - b.taskCount;
    case 'activity': return a.lastActivityAt.getTime() - b.lastActivityAt.getTime();
    case 'name': return 0;
  }
}

export function applyPeopleQuery(
  rows: PersonListRow[], query: PeopleQuery,
): PersonListRow[] {
  const normalizedQuery = normalizeHebrew(query.q);
  const filtered = rows.filter((row) => {
    if (!matchesView(row, query.view)) return false;
    if (query.dues) {
      const state: DuesState = row.dues?.state ?? 'none';
      if (state !== query.dues) return false;
    }
    return matchesSearch(row, normalizedQuery);
  });

  const sign = query.dir === 'desc' ? -1 : 1;
  return filtered.sort((a, b) => {
    const primary = compare(a, b, query.sort) * sign;
    if (primary !== 0) return primary;
    return a.displayName.localeCompare(b.displayName, 'he');
  });
}

/**
 * Counted against the rows as fetched, never against the filtered ones: a tab
 * that reads `0` while you are typing in the search box is telling you about
 * your search, not about the view. The row count under the toolbar is the
 * filtered length and answers that other question.
 */
export function viewCounts(rows: PersonListRow[]): Record<PeopleView, number> {
  const counts = {} as Record<PeopleView, number>;
  for (const view of PEOPLE_VIEWS) {
    counts[view] = rows.filter((row) => matchesView(row, view)).length;
  }
  return counts;
}

/**
 * The list's own params, minus the three a drawer owns.
 *
 * `peek` and `act` are stripped by the kit's own builder; `with` is stripped
 * here, because a survivor id left standing after a merge panel closes would
 * reopen the panel the moment any other link on the page was followed.
 */
function carried(params: RawParams): URLSearchParams {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === PEEK_PARAM || key === ACT_PARAM || key === MERGE_WITH_PARAM) continue;
    if (value === undefined) continue;
    for (const single of Array.isArray(value) ? value : [value]) next.append(key, single);
  }
  return next;
}

/** `?peek=<id>` over whatever the list is currently showing. */
export function peekHref(params: RawParams, personId: string): string {
  return openPeekHref(PEOPLE_PATH, carried(params), personId);
}

/** `?peek=<absorbed>&act=merge&with=<survivor>` — A3's two-record action drawer. */
export function mergeHref(params: RawParams, sourceId: string, targetId: string): string {
  const withSurvivor = carried(params);
  withSurvivor.set(MERGE_WITH_PARAM, targetId);
  return openPeekHref(PEOPLE_PATH, withSurvivor, sourceId, 'merge');
}

/** Back to the list, with the season, the view, the search and the sort intact. */
export function closeDrawerHref(params: RawParams): string {
  return closePeekHref(PEOPLE_PATH, carried(params));
}
