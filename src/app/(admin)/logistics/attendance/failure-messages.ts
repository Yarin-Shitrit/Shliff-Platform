import { toHebrewError, type HebrewErrors } from '@/lib/errors/hebrew';

/**
 * R9: no English reaches a Hebrew screen. Every refusal the attendance
 * library throws is mapped here, at the action boundary, and anything
 * unmapped becomes a Hebrew fallback and a log line — never an echo.
 *
 * Every key is an ENGLISH PREFIX of the thrown message, because that is what
 * `toHebrewError` matches on.
 */

/** The refusals the drawer also makes for itself, before the round trip,
 *  in the same words. */
export const DAY_REQUIRED = 'צריך לבחור יום מהלוח, למשל 14/03/2026';
export const KIND_REQUIRED = 'צריך לבחור מה היה ביום הזה — יום עבודה, יום הקמות, קניות…';

const EVENT_UNKNOWN = 'לא מצאנו את היום הזה בלוח הנוכחות';
const SEASON_UNKNOWN = 'לא מצאנו את השנה הזו';

export const EVENT_ERRORS: HebrewErrors = [
  ['an occasion needs a real day', DAY_REQUIRED],
  ['unknown attendance kind', KIND_REQUIRED],
  ['unknown occasion', EVENT_UNKNOWN],
  ['unknown season', SEASON_UNKNOWN],
];

export function eventFailureMessage(error: unknown): string {
  return toHebrewError(error, EVENT_ERRORS);
}

/**
 * A mark has three ways to be refused, and each names what to do instead:
 * a cancelled day is restored from its own drawer, and a person who is not
 * on the roster is added on אנשים — the board never adds anyone itself.
 */
export const NOT_ON_ROSTER = 'האדם הזה לא ברשימת החברים של השנה. מוסיפים אותו קודם במסך אנשים, ואז מסמנים';
export const EVENT_CANCELLED = 'היום הזה בוטל, ולכן אי אפשר לסמן בו נוכחות. אפשר להחזיר אותו ללוח מתוך החלונית שלו';

export const MARK_ERRORS: HebrewErrors = [
  ['unknown occasion', EVENT_UNKNOWN],
  ['that occasion was cancelled', EVENT_CANCELLED],
  ['that person is not on this season roster', NOT_ON_ROSTER],
  ['unknown person', NOT_ON_ROSTER],
];

export function markFailureMessage(error: unknown): string {
  return toHebrewError(error, MARK_ERRORS);
}

/**
 * A personal mark — one person, one thing they did alone — is refused for
 * the same roster reason a mark is, and for two of its own: it needs a day
 * on the calendar and words that say what was done. The drawer makes the
 * same three refusals before the round trip, in these words.
 */
export const PERSON_REQUIRED = 'צריך לבחור למי הסימון';
export const TITLE_REQUIRED = 'צריך לכתוב מה נעשה — למשל ״הביא את הגנרטור״';
const PERSONAL_UNKNOWN = 'לא מצאנו את הסימון הזה. אולי כבר הוסר';

export const PERSONAL_ERRORS: HebrewErrors = [
  ['a personal mark needs a real day', DAY_REQUIRED],
  ['a personal mark needs a title', TITLE_REQUIRED],
  ['unknown personal mark', PERSONAL_UNKNOWN],
  ['unknown season', SEASON_UNKNOWN],
  ['that person is not on this season roster', NOT_ON_ROSTER],
  ['unknown person', PERSON_REQUIRED],
];

export function personalFailureMessage(error: unknown): string {
  return toHebrewError(error, PERSONAL_ERRORS);
}
