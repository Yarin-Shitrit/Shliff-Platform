import {
  toHebrewError, HEBREW_FALLBACK, type HebrewErrors, type HebrewConstraints,
} from '@/lib/errors/hebrew';

/**
 * R9: no English reaches a Hebrew screen. Every refusal the plan library
 * throws is mapped here, at the action boundary, and anything unmapped
 * becomes a Hebrew fallback and a log line — never an echo.
 *
 * Every key is an ENGLISH PREFIX of the thrown message, because that is what
 * `toHebrewError` matches on.
 */

/** The refusals the drawers also make for themselves, before the round
 *  trip, in the same words. */
export const TOPIC_NAME_REQUIRED = 'לנושא חייב להיות שם, אחרת אי אפשר למצוא אותו ברשימה';
export const TITLE_REQUIRED = 'למשימה חייב להיות שם, אחרת אי אפשר לזהות אותה בלוח';
export const END_BEFORE_START = 'יום הסיום לא יכול להיות לפני יום ההתחלה';
export const END_WITHOUT_START = 'יום סיום בלי יום התחלה לא אומר כלום — צריך לבחור מתי מתחילים';
export const BAD_DAY = 'צריך לבחור יום מהלוח, למשל 14/05/2026';
export const DEPENDENCY_REQUIRED = 'צריך לבחור איזו משימה חייבת להסתיים קודם';
/** A purchase's line is finished when the thing arrives, and that is said on רכש. */
export const PURCHASE_DONE_ON_LIST = 'משימת רכש מסתיימת כשהפריט מגיע — מעדכנים את הסטטוס ברשימת הרכש';
export const NOTHING_CHOSEN = 'צריך לסמן לפחות משימה אחת להעברה';

const TOPIC_UNKNOWN = 'לא מצאנו את הנושא הזה';
const ITEM_UNKNOWN = 'לא מצאנו את המשימה הזו בלוח';

export const TOPIC_ERRORS: HebrewErrors = [
  ['a topic needs a name', TOPIC_NAME_REQUIRED],
  ['a topic with that name already exists', 'כבר יש נושא בשם הזה בשנה הזו'],
  ['unknown topic', TOPIC_UNKNOWN],
  ['unknown season', 'לא מצאנו את השנה הזו'],
];

export const ITEM_ERRORS: HebrewErrors = [
  ['a work item needs a title', TITLE_REQUIRED],
  ['a work item needs a real start day', BAD_DAY],
  ['a work item needs a real end day', BAD_DAY],
  ['a work item cannot end before it starts', END_BEFORE_START],
  ['a work item cannot be its own parent', 'משימה לא יכולה להיות תת־משימה של עצמה'],
  ['a sub-item cannot have sub-items of its own', 'יש רק שתי רמות: משימה ותת־משימות שלה. תת־משימה לא יכולה להכיל תת־משימות'],
  ['a purchase item is done when its purchase arrives', PURCHASE_DONE_ON_LIST],
  ['unknown work item status', 'המצב הזה אינו אחד משלושת המצבים האפשריים'],
  ['unknown work item', ITEM_UNKNOWN],
  ['unknown topic', TOPIC_UNKNOWN],
  ['unknown person', 'האדם הזה לא ברשימת החברים'],
  ['unknown season', 'לא מצאנו את השנה הזו'],
];

export const DEPENDENCY_ERRORS: HebrewErrors = [
  ['a work item cannot wait for itself', 'משימה לא יכולה לחכות לעצמה'],
  ['a dependency cannot cross seasons', 'שתי המשימות חייבות להיות באותה שנה'],
  ['that dependency already exists', 'הקשר הזה כבר קיים'],
  ['that dependency would make a cycle', 'הקשר הזה סוגר מעגל — משימה שמחכה למשימה שמחכה לה. אי אפשר לסדר לוח כזה'],
  ['unknown dependency', 'לא מצאנו את הקשר הזה'],
  ['unknown work item', ITEM_UNKNOWN],
];

/**
 * Moving the board's buying items into the acquisitions list. The move is
 * one transaction, so a refusal here means nothing moved.
 */
export const ADOPT_ERRORS: HebrewErrors = [
  ['nothing was chosen', NOTHING_CHOSEN],
  ['several acquisitions share the name', 'ברשימת הרכש יש יותר מפריט אחד בשם של אחת המשימות שסומנו, ואי אפשר לדעת לאיזה מהם לקשר אותה. שום דבר לא הועבר'],
  ['a borrowed work item needs a lender', 'אחת המשימות שסומנו היא השאלה, והשאלה צריכה שם של המשאיל/ה — את זה ממלאים ברשימת הרכש. שום דבר לא הועבר'],
  ['work item', 'אחת המשימות שסומנו כבר ברשימת הרכש, או שכבר אינה פתוחה. שום דבר לא הועבר'],
  ['unknown work item', ITEM_UNKNOWN],
  ['unknown season', 'לא מצאנו את השנה הזו'],
];

/** The driver naming the refusal, for the pair the library’s own check raced. */
export const DEPENDENCY_CONSTRAINTS: HebrewConstraints = [
  ['work_dependencies_pair_key', 'הקשר הזה כבר קיים'],
];

function withFallback(error: unknown, map: HebrewErrors, fallback: string, constraints: HebrewConstraints = []): string {
  const hebrew = toHebrewError(error, map, constraints);
  return hebrew === HEBREW_FALLBACK ? fallback : hebrew;
}

export function topicFailureMessage(error: unknown): string {
  return withFallback(error, TOPIC_ERRORS, 'שמירת הנושא נכשלה. נסו שוב.');
}

export function itemFailureMessage(error: unknown): string {
  return withFallback(error, ITEM_ERRORS, 'שמירת המשימה נכשלה. נסו שוב.');
}

export function dependencyFailureMessage(error: unknown): string {
  return withFallback(error, DEPENDENCY_ERRORS, 'שמירת הקשר נכשלה. נסו שוב.', DEPENDENCY_CONSTRAINTS);
}

export function adoptFailureMessage(error: unknown): string {
  return withFallback(error, ADOPT_ERRORS, 'ההעברה לרכש נכשלה. שום דבר לא הועבר. נסו שוב.');
}
