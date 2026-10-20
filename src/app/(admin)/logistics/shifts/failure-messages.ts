import { toHebrewError, HEBREW_FALLBACK, type HebrewErrors } from '@/lib/errors/hebrew';
import { ASSIGN_ERRORS } from '@/app/(admin)/tasks/failure-messages';
import { EVENT_CLOSES, EVENT_OPENS } from '@/lib/logistics/shift-time';

/**
 * R9: no English reaches a Hebrew screen. Every refusal the shifts library
 * throws is mapped here, at the action boundary, and anything unmapped
 * becomes a Hebrew fallback and a log line — never an echo.
 *
 * Every key is an ENGLISH PREFIX of the thrown message, because that is what
 * `toHebrewError` matches on. The assignment refusals are the board's own
 * (`ASSIGN_ERRORS`), imported rather than retyped, so a duplicate name is
 * refused in the same words on both screens.
 */

/** The three refusals the drawers also make for themselves, before the
 *  round trip, in the same words. */
export const TYPE_NAME_REQUIRED = 'לסוג משמרת חייב להיות שם, אחרת אי אפשר לזהות אותו בלוח';
export const CLOCKS_REQUIRED = 'צריך לציין שעת התחלה ושעת סיום, למשל 16:00';
export const PEOPLE_REQUIRED = 'צריך לפחות אדם אחד במשמרת';
export const DAY_REQUIRED = 'צריך לבחור לפחות יום אחד';
export const TYPE_REQUIRED = 'צריך לבחור סוג משמרת';

export const OUTSIDE_WINDOW =
  `המשמרת חורגת מזמן האירוע — מיום הפתיחה ב־${EVENT_OPENS.clock} עד יום הסיום ב־${EVENT_CLOSES.clock}`;

const TYPE_UNKNOWN = 'לא מצאנו את סוג המשמרת הזה';
const SLOT_UNKNOWN = 'לא מצאנו את המשמרת הזו בלוח';
const NO_GATE = 'לשנה הזו עדיין לא נקבע תאריך פתיחת השער, ולכן אין לוח לשבץ בו';

export const TYPE_ERRORS: HebrewErrors = [
  ['a shift type needs a name', TYPE_NAME_REQUIRED],
  ['a shift type needs a start and an end clock', CLOCKS_REQUIRED],
  ['a shift type needs at least one person', PEOPLE_REQUIRED],
  ['a shift type with that name already exists', 'כבר יש סוג משמרת בשם הזה'],
  ['unknown shift type', TYPE_UNKNOWN],
];

export const SLOT_ERRORS: HebrewErrors = [
  ['unknown shift type', TYPE_UNKNOWN],
  ['that shift type was retired', 'סוג המשמרת הזה יצא משימוש — אפשר להחזיר אותו לשימוש מהרשימה'],
  ['a shift needs a start and an end clock', CLOCKS_REQUIRED],
  ['a task needs at least one person', PEOPLE_REQUIRED],
  ['a shift needs at least one day', DAY_REQUIRED],
  ['a shift lies outside the event window', OUTSIDE_WINDOW],
  ['unknown shift', SLOT_UNKNOWN],
  ['unknown season', 'לא מצאנו את השנה הזו'],
  ['the season has no gate date', NO_GATE],
];

function withFallback(error: unknown, map: HebrewErrors, fallback: string): string {
  const hebrew = toHebrewError(error, map);
  return hebrew === HEBREW_FALLBACK ? fallback : hebrew;
}

export function typeFailureMessage(error: unknown): string {
  return withFallback(error, TYPE_ERRORS, 'שמירת סוג המשמרת נכשלה. נסו שוב.');
}

export function slotFailureMessage(error: unknown): string {
  return withFallback(error, SLOT_ERRORS, 'שמירת המשמרת נכשלה. נסו שוב.');
}

export function assignFailureMessage(error: unknown): string {
  return withFallback(error, [...ASSIGN_ERRORS, ...SLOT_ERRORS], 'השיבוץ נכשל. נסו שוב.');
}
