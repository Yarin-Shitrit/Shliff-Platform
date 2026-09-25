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
  ['an item id must be a uuid', 'לפריט החדש אין מזהה תקין. טעינה מחדש של המפה תסדר את זה'],
  ['an item id is already in use', 'הפריט הזה כבר נמצא במפה. טעינה מחדש של המפה תסדר את זה'],
  ['an item height must be', 'גובה של פריט צריך להיות בין 10 סנטימטר ל־20 מטר, במספר שלם של סנטימטרים'],
  ['a lock must be', 'נעילה היא כן או לא'],
  ['that item is locked', 'הפריט נעול. אפשר לשחרר את הנעילה ואז לשנות אותו'],
  ['a kind default must be', 'מידות ברירת המחדל צריכות להיות בין 10 סנטימטר ל־500 מטר, והגובה עד 20 מטר'],
  ['north must be', 'כיוון הצפון נמדד במעלות שלמות, מ־0 עד 359'],
  ['unknown operation', 'השינוי הזה לא מוכר למפה. טעינה מחדש של המפה תסדר את זה'],
  ['an item sort must be', 'סדר הציור של פריט הוא מספר שלם, אפס או יותר. טעינה מחדש של המפה תסדר את זה'],
  // The pipes and cables (`src/lib/site/lines.ts`, `editor/ops.ts`).
  ['unknown site line', 'לא מצאנו את הצינור או הכבל הזה במפה — אולי הוסר בינתיים'],
  ['a line end is not an item on this map', 'אחד הקצוות של הקו כבר לא במפה — אולי הפריט הוסר בינתיים'],
  ['unknown line kind', 'הסוג הזה אינו צינור מים ואינו כבל חשמל'],
  ['a line must have a label', 'לצינור או לכבל חייב להיות שם, אחרת אי אפשר לזהות אותו במפה'],
  ['a line must join two different items', 'צינור או כבל מחברים שני פריטים שונים'],
  ['a water pipe joins only', 'צינור מים מחבר רק מיכל מי שתייה, מקלחת, כיור או מפצל'],
  ['a power cable joins only', 'כבל חשמל מחבר רק גנרטור, מקרר, תאורה או מפצל'],
  ['a water pipe runs from', 'צינור מים יוצא רק ממיכל מי שתייה או ממפצל, לא ממקלחת או מכיור. לכמה פריטים מחברים דרך מפצל'],
  ['a power cable runs from', 'כבל חשמל יוצא רק מהגנרטור או ממפצל, לא ממקרר או מתאורה. לכמה פריטים מחברים דרך מפצל'],
  ['a line bend must be', 'נקודת פנייה נמדדת במספר שלם של סנטימטרים על המפה'],
  ['a line end must be', 'קצה של קו הוא פריט במפה. טעינה מחדש של המפה תסדר את זה'],
  ['a line id must be a uuid', 'לקו החדש אין מזהה תקין. טעינה מחדש של המפה תסדר את זה'],
  ['a line id is already in use', 'הקו הזה כבר נמצא במפה. טעינה מחדש של המפה תסדר את זה'],
  ['a line sort must be', 'סדר הקווים הוא מספר שלם, אפס או יותר. טעינה מחדש של המפה תסדר את זה'],
  ['an item with a line attached keeps', 'לפריט מחובר צינור או כבל, ולכן אי אפשר להפוך אותו לסוג שהקו לא מגיע אליו. קודם מסירים את הקו'],
];

export function siteFailureMessage(error: unknown): string {
  return toHebrewError(error, SITE_ERRORS);
}

/** The drawer's own pre-flight refusals, in the library's words. */
export const LABEL_REQUIRED = SITE_ERRORS.find(([prefix]) => prefix === 'an item must have a label')![1];
export const LINE_LABEL_REQUIRED = SITE_ERRORS.find(([prefix]) => prefix === 'a line must have a label')![1];
export const PLOT_SIDE_INVALID = SITE_ERRORS.find(([prefix]) => prefix === 'a plot side must be')![1];
export const ITEM_SIDE_INVALID = SITE_ERRORS.find(([prefix]) => prefix === 'an item side must be')![1];
export const NORTH_INVALID = SITE_ERRORS.find(([prefix]) => prefix === 'north must be')![1];
