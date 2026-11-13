import { ACT_PARAM, PEEK_PARAM } from '@/components/ui/drawer-url';
import { isCivilDay } from './shift-time';

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
 *
 * The timeline's scale travels too — `?scale=week|month` with `?at=<day>`
 * for the week or month that holds that day — so a drawer opened from the
 * week view closes back onto the week view, and a link to ״השבוע של
 * הבנייה״ can be sent to someone. `all`, the default, is spelled by its
 * absence.
 */

export const PLAN_PATH = '/logistics/plan';

export const NEW_TOPIC_ACT = 'topic';
export const NEW_ITEM_ACT = 'item';
export const ADOPT_ACT = 'purchases';
export const TOPIC_PARAM = 'topic';
export const PARENT_PARAM = 'parent';
export const SCALE_PARAM = 'scale';
export const AT_PARAM = 'at';

/**
 * How much of the calendar the timeline shows at once. Spelled here, not
 * in `plan.ts`, because this file is what the client drawers import, and
 * it must stay free of the database.
 */
export type TimelineScale = 'week' | 'month' | 'all';

export const TIMELINE_SCALES: readonly TimelineScale[] = ['week', 'month', 'all'];

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
  /** `?scale=`: how much of the calendar the timeline shows. `all` when absent or unknown. */
  scale: TimelineScale;
  /** `?at=`: a day inside the week or month to show; null when absent or not a day. */
  at: string | null;
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
  const rawScale = one(params[SCALE_PARAM]) as TimelineScale;
  const at = one(params[AT_PARAM]);

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
    scale: TIMELINE_SCALES.includes(rawScale) ? rawScale : 'all',
    at: isCivilDay(at) ? at : null,
    adopting: peek === null && topic === null && act === ADOPT_ACT,
  };
}

const KEYS = ['season', SCALE_PARAM, AT_PARAM] as const;
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

/**
 * The timeline at another scale, or the same scale around another day.
 * `all` needs no day and drops the one it had.
 */
export function scaleHref(params: RawParams, scale: TimelineScale, at: string | null = null): string {
  return planHref(params, {
    [SCALE_PARAM]: scale === 'all' ? null : scale,
    [AT_PARAM]: scale === 'all' ? null : at,
  });
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
