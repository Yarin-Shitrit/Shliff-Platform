import { ACT_PARAM, PEEK_PARAM } from '@/components/ui/drawer-url';
import type { LogisticsCategory } from '@/db/schema/logistics';

/**
 * The warehouse's filter state, and the only place its URL is spelled.
 *
 * Sorting and filtering are URL params resolved on the server, not client
 * state. Plan `ui-03` Task 2 rules that the kit's `Table` has no `onSort`,
 * because a table that re-sorted in the browser would sort only the rows it
 * was handed and then disagree with the totals row and the row count, which
 * the page computes over the whole filtered set. This module is the server
 * half of that contract.
 */

export const WAREHOUSE_VIEWS = ['all', 'attention', 'retired'] as const;
export type WarehouseView = (typeof WAREHOUSE_VIEWS)[number];

export const WAREHOUSE_SORTS = ['condition', 'name', 'category', 'quantity', 'location'] as const;
export type WarehouseSort = (typeof WAREHOUSE_SORTS)[number];

const CATEGORIES: readonly LogisticsCategory[] = [
  'kitchen', 'sanitation', 'living', 'build', 'general',
];

export const WAREHOUSE_PATH = '/logistics/warehouse';

/**
 * The verb behind `?act=`. A create drawer has no record to peek at (§5 A3),
 * so it is spelled as an action rather than as a second boolean param that
 * every href builder would then have to remember to clear.
 */
export const NEW_ITEM_ACT = 'item';

/** The verb that opens the drawer adding a box. */
export const NEW_BOX_ACT = 'box';

/**
 * `?box=<id>`: the drawer over one box — its name, its place and what is in
 * it. Not `peek`, because `peek` names an item and the two drawers are
 * different records; a URL naming both means the item, and `parseWarehouseQuery`
 * says so. With `?act=item` beside it, the same param instead pre-fills the
 * create drawer with the box, so "add an item to this box" is one link.
 */
export const BOX_PARAM = 'box';

export interface WarehouseQuery {
  view: WarehouseView;
  q: string;
  category: LogisticsCategory | null;
  sort: WarehouseSort;
  dir: 'asc' | 'desc';
  peek: string | null;
  /** `?act=item` and no `peek`: the drawer that adds an item by hand. */
  creating: boolean;
  /** `?box=<id>` alone: the drawer over that box. */
  peekBox: string | null;
  /** `?act=item&box=<id>`: the create drawer, with the box already chosen. */
  presetBox: string | null;
  /** `?act=box` with neither record named: the drawer that adds a box. */
  creatingBox: boolean;
}

export type RawParams = Record<string, string | string[] | undefined>;

/**
 * The whole warehouse, no filter and no drawer — what another screen asks
 * for when it needs every item as an option (the arrival drawer's "more of
 * something we own", the build screen's "it is in stock"). Spelled once so a
 * field added to `WarehouseQuery` cannot leave one of those screens behind.
 */
export function everyItem(sort: WarehouseSort = 'name'): WarehouseQuery {
  return {
    view: 'all', q: '', category: null, sort, dir: 'asc',
    peek: null, creating: false, peekBox: null, presetBox: null, creatingBox: false,
  };
}

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * Never throws. Every param here can arrive truncated or mangled from a link
 * someone pasted into a chat, and the right answer to that is the default
 * view rather than an error page.
 *
 * There is deliberately no `season` field. The warehouse is camp-wide (R5):
 * a season param is ignored rather than honoured, and the screen says so out
 * loud instead of leaving a lead to wonder why the list never changes.
 */
export function parseWarehouseQuery(params: RawParams): WarehouseQuery {
  const rawView = one(params.view) as WarehouseView;
  const rawSort = one(params.sort) as WarehouseSort;
  const rawCat = one(params.cat) as LogisticsCategory;

  const peek = one(params[PEEK_PARAM]) || null;
  const box = one(params[BOX_PARAM]) || null;
  const act = one(params[ACT_PARAM]);

  /*
   * A `peek` wins. A URL naming both a record and the create verb means one
   * of the two, and the record is the one a lead asked to see by id —
   * opening a blank form over it would lose that row with nothing on screen
   * saying so. The same rule puts an item's drawer over a box's: the item
   * is the narrower thing asked for.
   */
  const creating = peek === null && act === NEW_ITEM_ACT;

  return {
    view: WAREHOUSE_VIEWS.includes(rawView) ? rawView : 'all',
    q: one(params.q).trim(),
    category: CATEGORIES.includes(rawCat) ? rawCat : null,
    // Condition first: somebody opening the warehouse is asking what needs
    // doing before the camp leaves, not for an alphabetical list.
    sort: WAREHOUSE_SORTS.includes(rawSort) ? rawSort : 'condition',
    dir: one(params.dir) === 'desc' ? 'desc' : 'asc',
    peek,
    creating,
    peekBox: peek === null && !creating ? box : null,
    presetBox: creating ? box : null,
    creatingBox: peek === null && box === null && act === NEW_BOX_ACT,
  };
}

const KEYS = ['view', 'q', 'cat', 'sort', 'dir'] as const;
type PatchKey = (typeof KEYS)[number] | typeof PEEK_PARAM | typeof ACT_PARAM | typeof BOX_PARAM;

/**
 * One param changed, the rest preserved, and any open drawer dropped.
 *
 * The drawer is dropped because the peeked row may not survive the new filter,
 * and a drawer standing over a row that is no longer in the list is a dead end
 * with no way back that a lead would guess. `act` and `box` go with it: no
 * drawer param is in `KEYS`, so none is copied forward unless the patch asks
 * for it by name.
 */
export function warehouseHref(
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
  if (!(PEEK_PARAM in patch)) next.delete(PEEK_PARAM);

  const qs = next.toString();
  return qs ? `${WAREHOUSE_PATH}?${qs}` : WAREHOUSE_PATH;
}

/**
 * A category chip toggles: clicking the active one clears the filter rather
 * than re-applying it, so there is always a way back to everything without
 * hunting for a "clear" control.
 */
export function categoryHref(params: RawParams, category: LogisticsCategory): string {
  const active = one(params.cat) === category;
  return warehouseHref(params, { cat: active ? null : category });
}

/** The drawer over one item, per R6: a drawer is a URL. */
export function itemHref(params: RawParams, id: string): string {
  return warehouseHref(params, { [PEEK_PARAM]: id });
}

/** The create drawer, with whatever the lead was looking at kept underneath it. */
export function newItemHref(params: RawParams): string {
  return warehouseHref(params, { [ACT_PARAM]: NEW_ITEM_ACT });
}

/** The drawer over one box: what it is, where it is, what is in it. */
export function boxHref(params: RawParams, id: string): string {
  return warehouseHref(params, { [BOX_PARAM]: id });
}

/** The drawer that adds a box. */
export function newBoxHref(params: RawParams): string {
  return warehouseHref(params, { [ACT_PARAM]: NEW_BOX_ACT });
}

/**
 * The create drawer with the box already chosen — the link at the foot of a
 * box's contents. The lead still sees the choice and can change it; what the
 * URL saves them is picking the box they were just looking at.
 */
export function newItemInBoxHref(params: RawParams, boxId: string): string {
  return warehouseHref(params, { [ACT_PARAM]: NEW_ITEM_ACT, [BOX_PARAM]: boxId });
}

/**
 * A column header is a link, because sorting is a server concern (plan `ui-03`
 * Task 2). Clicking the column that is already sorted reverses it rather than
 * re-applying it — the second click on a header has a meaning everywhere else
 * in the world, and refusing to give it one reads as a broken control.
 */
export function sortHref(params: RawParams, sort: WarehouseSort): string {
  const active = (one(params.sort) || 'condition') === sort;
  const dir = active && one(params.dir) !== 'desc' ? 'desc' : 'asc';
  return warehouseHref(params, { sort, dir });
}

/**
 * The ייצוא button's destination: the same filters, as a file.
 *
 * Built from `warehouseHref` rather than from the params directly, so the
 * export and the screen can never disagree about what "the current view"
 * means — which is the whole risk of an export button, and the reason a file
 * that quietly held the unfiltered table would be worse than no button.
 */
export function warehouseExportHref(params: RawParams): string {
  const [, qs] = warehouseHref(params, {}).split('?');
  return qs ? `${WAREHOUSE_PATH}/export?${qs}` : `${WAREHOUSE_PATH}/export`;
}
