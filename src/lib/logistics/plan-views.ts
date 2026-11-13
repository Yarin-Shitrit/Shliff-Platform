import { ACT_PARAM, PEEK_PARAM } from '@/components/ui/drawer-url';

/**
 * The work plan's URL, and the only place it is spelled.
 *
 * Season-scoped (R5): a plan is one season's. Every link carries `season`
 * forward.
 *
 * Three drawers, and a rule for which one wins:
 *
 * - `?peek=<itemId>` — one item: its days, its person, what it waits for.
 * - `?topic=<id>` — one topic, to rename or archive. With `?act=item` beside
 *   it the same param instead pre-fills the new-item drawer with the topic.
 * - `?act=item` — a new item, optionally with `?topic=` or `?parent=` chosen.
 *   `?act=topic` — a new topic.
 * - `?act=purchases` — the drawer that moves the board's ״לקנות…״ items
 *   into the acquisitions list.
 *
 * A `peek` wins over everything: it names a record a lead asked to see.
 */

export const PLAN_PATH = '/logistics/plan';

export const NEW_TOPIC_ACT = 'topic';
export const NEW_ITEM_ACT = 'item';
export const ADOPT_ACT = 'purchases';
export const TOPIC_PARAM = 'topic';
export const PARENT_PARAM = 'parent';

export interface PlanQuery {
  /** Empty means "the page picks", which `resolveSeason` does. */
  season: string;
  /** `?peek=<itemId>`: the drawer over one item. */
  peek: string | null;
  /** `?topic=<id>` alone: the drawer over one topic. */
  peekTopic: string | null;
  /** `?act=topic` with no record named. */
  creatingTopic: boolean;
  /** `?act=item` with no `peek`. */
  creatingItem: boolean;
  /** `?act=item&topic=<id>`: the new item under that topic. */
  presetTopic: string | null;
  /** `?act=item&parent=<id>`: the new item as a sub-item of that one. */
  presetParent: string | null;
  /** `?act=purchases` with no record named: the move-to-acquisitions drawer. */
  adopting: boolean;
}

export type RawParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** Never throws: every param here can arrive mangled from a pasted link. */
export function parsePlanQuery(params: RawParams): PlanQuery {
  const peek = one(params[PEEK_PARAM]) || null;
  const topic = one(params[TOPIC_PARAM]) || null;
  const parent = one(params[PARENT_PARAM]) || null;
  const act = one(params[ACT_PARAM]);

  const creatingItem = peek === null && act === NEW_ITEM_ACT;
  const peekTopic = peek === null && !creatingItem ? topic : null;

  return {
    season: one(params.season),
    peek,
    peekTopic,
    creatingTopic: peek === null && !creatingItem && topic === null && act === NEW_TOPIC_ACT,
    creatingItem,
    presetTopic: creatingItem ? topic : null,
    presetParent: creatingItem ? parent : null,
    adopting: peek === null && topic === null && act === ADOPT_ACT,
  };
}

const KEYS = ['season'] as const;
type PatchKey =
  | (typeof KEYS)[number] | typeof PEEK_PARAM | typeof ACT_PARAM
  | typeof TOPIC_PARAM | typeof PARENT_PARAM;

/**
 * One param changed, the season preserved, and any open drawer dropped
 * unless the patch names it. Every drawer link on the page is built here,
 * so none of them can forget the season.
 */
export function planHref(
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
  return qs ? `${PLAN_PATH}?${qs}` : PLAN_PATH;
}

/** The drawer over one item (R6: a drawer is a URL). */
export function itemHref(params: RawParams, itemId: string): string {
  return planHref(params, { [PEEK_PARAM]: itemId });
}

/** The drawer over one topic. */
export function topicHref(params: RawParams, topicId: string): string {
  return planHref(params, { [TOPIC_PARAM]: topicId });
}

/** The drawer that adds a topic. */
export function newTopicHref(params: RawParams): string {
  return planHref(params, { [ACT_PARAM]: NEW_TOPIC_ACT });
}

/**
 * The new-item drawer, with whatever the lead was looking at pre-filled:
 * the topic whose heading they clicked, or the item they want a part of.
 * Both stay changeable in the drawer; the URL only saves the picking.
 */
export function newItemHref(
  params: RawParams, preset: { topicId?: string; parentId?: string } = {},
): string {
  return planHref(params, {
    [ACT_PARAM]: NEW_ITEM_ACT,
    [TOPIC_PARAM]: preset.topicId ?? null,
    [PARENT_PARAM]: preset.parentId ?? null,
  });
}

/** The drawer that moves the board's buying items into the acquisitions list. */
export function adoptHref(params: RawParams): string {
  return planHref(params, { [ACT_PARAM]: ADOPT_ACT });
}
