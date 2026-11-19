import { toHebrewError, type HebrewErrors } from '@/lib/errors/hebrew';

/**
 * R9: no English reaches a Hebrew screen. Every refusal `setCrewMember`
 * throws is mapped here, at the action boundary; anything unmapped becomes
 * a Hebrew fallback and a log line — never an echo.
 *
 * Every key is an ENGLISH PREFIX of the thrown message.
 */

const ITEM_UNKNOWN = 'לא מצאנו את המשימה הזו בלוח העבודה';
export const ITEM_CANCELLED = 'המשימה הזו בוטלה, ולכן אי אפשר לשבץ אליה. אפשר לפתוח אותה מחדש בלוח העבודה';
export const NOT_ON_ROSTER = 'האדם הזה לא ברשימת החברים של השנה. מוסיפים אותו קודם במסך אנשים, ואז משבצים';

export const CREW_ERRORS: HebrewErrors = [
  ['unknown work item', ITEM_UNKNOWN],
  ['that work item was cancelled', ITEM_CANCELLED],
  ['that person is not on this season roster', NOT_ON_ROSTER],
  ['unknown person', NOT_ON_ROSTER],
];

export function crewFailureMessage(error: unknown): string {
  return toHebrewError(error, CREW_ERRORS);
}
