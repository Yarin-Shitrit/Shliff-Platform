import type {
  LogisticsCategory, ItemCondition, AcquisitionSource, AcquisitionStatus,
} from '@/db/schema/logistics';
import type { MaterialState } from './build';

/**
 * The library home for every logistics enum label, and deliberately the only
 * one. `work/labels.ts` records why: four copies of one idea lived across three
 * files, and one of them was typed `Record<string, string>` — so a fifth member
 * could be added and that screen would render the raw enum value on a Hebrew
 * page with nothing to catch it.
 *
 * Every map here is `Record<T, string>`, which makes `tsc` the exhaustiveness
 * check, and `labels.test.ts` nets the repo for a second copy appearing.
 *
 * These are one register, not three. Logistics has no plural/singular split to
 * carry: a category heading and a category chip read the same, so collapsing
 * them would not be the copy change in disguise that it was for task kinds.
 */

export const CATEGORY_LABELS: Record<LogisticsCategory, string> = {
  kitchen: 'מטבח',
  sanitation: 'מקלחות ותברואה',
  living: 'מרחב מחיה',
  build: 'בנייה, כלים ותשתיות',
  general: 'כללי',
};

/**
 * `retired` is the state the original requirements did not ask for. It is here
 * because the product does not delete: a pump broken beyond repair becomes a
 * row that says `יצא משימוש`, not an absence. An absence cannot be told apart
 * from "nobody has entered it yet", which is the ambiguity this platform is
 * built to remove.
 */
export const CONDITION_LABELS: Record<ItemCondition, string> = {
  ready: 'תקין ומוכן',
  needs_testing: 'דורש בדיקה',
  needs_repair: 'דורש תיקון',
  retired: 'יצא משימוש',
};

/**
 * What a row with no season is called, everywhere it is called anything: the
 * table's pill, the drawer's subtitle, the export column. One string, so the
 * file a lead downloads uses the word the screen taught them.
 */
export const CAMP_WIDE_LABEL = 'כלל־קאמפי';

export const SOURCE_LABELS: Record<AcquisitionSource, string> = {
  buy_new: 'לקנות חדש',
  second_hand: 'יד שנייה',
  borrow_member: 'השאלה מחבר קאמפ',
};

export const STATUS_LABELS: Record<AcquisitionStatus, string> = {
  to_search: 'לחפש',
  in_review: 'במשא ומתן',
  ordered: 'הוזמן',
  arrived: 'הגיע למחסן',
};

/**
 * The tone each condition renders as, so no screen picks a colour for itself.
 * R3: every state pill carries a word, never colour alone — these only decide
 * which word gets which tone, and `retired` is `outline` rather than a status
 * colour because it is a fact about the item, not a problem to act on.
 */
export const CONDITION_TONES: Record<ItemCondition, 'ok' | 'warn' | 'bad' | 'outline'> = {
  ready: 'ok',
  needs_testing: 'warn',
  needs_repair: 'bad',
  retired: 'outline',
};

export const STATUS_TONES: Record<AcquisitionStatus, 'ok' | 'warn' | 'bad' | 'info'> = {
  to_search: 'bad',
  in_review: 'info',
  ordered: 'warn',
  arrived: 'ok',
};

/**
 * The fifth map, and the only one whose enum is not in the schema:
 * `MaterialState` is derived at read time from a material's two links, never
 * stored (see `build.ts`). It is named here all the same, because the reason
 * this file exists — one home, `Record<T, string>`, tsc as the exhaustiveness
 * check — applies to a computed vocabulary exactly as it does to a stored one.
 *
 * `במחסן · דורש תיקון` says both halves on purpose. "Needs repair" alone
 * would send somebody out to buy one, when the camp owns one and it is three
 * metres away.
 */
export const MATERIAL_STATE_LABELS: Record<MaterialState, string> = {
  in_stock: 'במחסן',
  needs_repair: 'במחסן · דורש תיקון',
  obtained: 'הושג',
  missing: 'צריך להשיג',
};

export const MATERIAL_STATE_TONES: Record<MaterialState, 'ok' | 'warn' | 'bad' | 'info'> = {
  in_stock: 'ok',
  needs_repair: 'warn',
  obtained: 'info',
  missing: 'bad',
};
