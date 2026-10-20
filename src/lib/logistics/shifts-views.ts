import { ACT_PARAM, PEEK_PARAM } from '@/components/ui/drawer-url';

/**
 * The shifts screen's URL, and the only place it is spelled.
 *
 * Season-scoped (R5): the schedule is one season's, because its slots are
 * that season's tasks. Every link carries `season` forward. The shift types
 * are camp-wide and the page says so beside them, but they ride on the same
 * URL — there is no second screen to lose a lead on.
 *
 * Three drawers, one param each, and a rule for which one wins:
 *
 * - `?peek=<taskId>` — one scheduled shift: its window, its people.
 * - `?type=<id>` — one shift type, to edit or retire. With `?act=slot` beside
 *   it the same param instead pre-fills the scheduling drawer with the type.
 * - `?act=type` — a new type. `?act=slot` — scheduling shifts, optionally
 *   with `?type=` and `?day=` already chosen.
 *
 * A `peek` wins over everything: it names a record a lead asked to see by
 * id. Then the scheduling verb, then the type, then the new-type verb.
 */

export const SHIFTS_PATH = '/logistics/shifts';

export const NEW_TYPE_ACT = 'type';
export const SCHEDULE_ACT = 'slot';
export const TYPE_PARAM = 'type';
export const DAY_PARAM = 'day';

export interface ShiftsQuery {
  /** Empty means "the page picks", which `resolveSeason` does. */
  season: string;
  /** `?peek=<taskId>`: the drawer over one scheduled shift. */
  peek: string | null;
  /** `?type=<id>` alone: the drawer over one type. */
  peekType: string | null;
  /** `?act=type` with no record named. */
  creatingType: boolean;
  /** `?act=slot` with no `peek`. */
  scheduling: boolean;
  /** `?act=slot&type=<id>`: the scheduling drawer with the type chosen. */
  presetType: string | null;
  /** `?act=slot&day=YYYY-MM-DD`: the scheduling drawer with the day ticked. */
  presetDay: string | null;
}

export type RawParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** Never throws: every param here can arrive mangled from a pasted link. */
export function parseShiftsQuery(params: RawParams): ShiftsQuery {
  const peek = one(params[PEEK_PARAM]) || null;
  const type = one(params[TYPE_PARAM]) || null;
  const day = one(params[DAY_PARAM]) || null;
  const act = one(params[ACT_PARAM]);

  const scheduling = peek === null && act === SCHEDULE_ACT;
  const peekType = peek === null && !scheduling ? type : null;

  return {
    season: one(params.season),
    peek,
    peekType,
    creatingType: peek === null && !scheduling && type === null && act === NEW_TYPE_ACT,
    scheduling,
    presetType: scheduling ? type : null,
    presetDay: scheduling ? day : null,
  };
}

const KEYS = ['season'] as const;
type PatchKey =
  | (typeof KEYS)[number] | typeof PEEK_PARAM | typeof ACT_PARAM
  | typeof TYPE_PARAM | typeof DAY_PARAM;

/**
 * One param changed, the season preserved, and any open drawer dropped
 * unless the patch names it. Every drawer link on the page is built here, so
 * none of them can forget the season.
 */
export function shiftsHref(
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
  return qs ? `${SHIFTS_PATH}?${qs}` : SHIFTS_PATH;
}

/** The drawer over one scheduled shift (R6: a drawer is a URL). */
export function slotHref(params: RawParams, taskId: string): string {
  return shiftsHref(params, { [PEEK_PARAM]: taskId });
}

/** The drawer over one type. */
export function typeHref(params: RawParams, typeId: string): string {
  return shiftsHref(params, { [TYPE_PARAM]: typeId });
}

/** The drawer that adds a type. */
export function newTypeHref(params: RawParams): string {
  return shiftsHref(params, { [ACT_PARAM]: NEW_TYPE_ACT });
}

/**
 * The scheduling drawer, with whatever the lead was looking at pre-filled:
 * the type whose row they clicked, the day whose column. Both stay visible
 * and changeable in the drawer; the URL only saves the picking.
 */
export function scheduleHref(
  params: RawParams, preset: { typeId?: string; day?: string } = {},
): string {
  return shiftsHref(params, {
    [ACT_PARAM]: SCHEDULE_ACT,
    [TYPE_PARAM]: preset.typeId ?? null,
    [DAY_PARAM]: preset.day ?? null,
  });
}

/**
 * The id of one event day's heading on the board, and so the target of the
 * phone's day strip: `#shift-day-2` lands on the third day. One spelling,
 * because a link to an id that is spelled differently scrolls nowhere and
 * says nothing.
 */
export function dayAnchorId(index: number): string {
  return `shift-day-${index}`;
}

/**
 * The printable sheet: the same season, as a page of its own. Built from
 * `shiftsHref` so the sheet and the screen cannot name different seasons.
 */
export function printHref(params: RawParams): string {
  const [, qs] = shiftsHref(params, {}).split('?');
  return qs ? `${SHIFTS_PATH}/print?${qs}` : `${SHIFTS_PATH}/print`;
}
