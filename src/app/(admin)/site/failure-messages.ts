import { toHebrewError, type HebrewErrors } from '@/lib/errors/hebrew';

/**
 * R9: no English reaches a Hebrew screen. Every refusal `src/lib/site/plan.ts`
 * throws is mapped here, at the action boundary, and anything unmapped
 * becomes the Hebrew fallback plus a log line — never an echo of what the
 * library threw.
 *
 * The map is an argument rather than a registry (integration §5 A7). Every
 * key is an ENGLISH PREFIX of the thrown message, because that is what
 * `toHebrewError` matches on.
 */
export const SITE_ERRORS: HebrewErrors = [
  ['unknown season', 'לא מצאנו את השנה הזו'],
  ['unknown site plan', 'לא מצאנו את המפה הזו — אולי נמחקה בינתיים'],
  ['unknown site item', 'לא מצאנו את הפריט הזה במפה — אולי הוסר בינתיים'],
  ['this season already has a map', 'לשנה הזו כבר יש מפה. אפשר לערוך אותה, לא ליצור שנייה'],
  ['that season has no map to copy', 'לשנה שנבחרה אין מפה להעתיק ממנה'],
  ['a plot side must be', 'צלע המגרש צריכה להיות בין מטר אחד ל־500 מטר, במספר שלם של סנטימטרים'],
  ['a grid step must be', 'צעד הרשת צריך להיות בין 10 ל־200 סנטימטר'],
  ['unknown item kind', 'הסוג הזה אינו אחד מסוגי הפריטים שהמפה מכירה'],
  ['an item must have a label', 'לפריט חייב להיות שם, אחרת אי אפשר לזהות אותו במפה'],
  ['an item side must be', 'צלע של פריט צריכה להיות בין 10 סנטימטר ל־500 מטר, במספר שלם של סנטימטרים'],
  ['an item position must be', 'מיקום נמדד במספר שלם של סנטימטרים'],
  ['a shade inset must be', 'הרצועה ללא צל נמדדת במספר שלם של סנטימטרים, אפס או יותר'],
  ['that task is not a build task of this season', 'אפשר לקשר רק משימת הקמה של השנה הזו'],
];

export function siteFailureMessage(error: unknown): string {
  return toHebrewError(error, SITE_ERRORS);
}

/** The drawer's own pre-flight refusals, in the library's words. */
export const LABEL_REQUIRED = SITE_ERRORS.find(([prefix]) => prefix === 'an item must have a label')![1];
export const PLOT_SIDE_INVALID = SITE_ERRORS.find(([prefix]) => prefix === 'a plot side must be')![1];
export const ITEM_SIDE_INVALID = SITE_ERRORS.find(([prefix]) => prefix === 'an item side must be')![1];
