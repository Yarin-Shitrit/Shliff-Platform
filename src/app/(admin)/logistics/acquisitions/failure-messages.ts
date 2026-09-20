import { toHebrewError, type HebrewErrors } from '@/lib/errors/hebrew';

/**
 * R9: no English reaches a Hebrew screen. The library throws for whoever is
 * reading a stack trace, and every sentence a lead sees is mapped here, at the
 * action boundary — never echoed from what was thrown.
 *
 * The maps are arguments rather than a registry (integration §5 A7). Every key
 * is an English PREFIX, because several thrown messages interpolate an id, and
 * nothing here leans on the Hebrew passthrough: these interpolate too, and a
 * single Latin character would make a message degrade silently to the
 * fallback.
 */
export const REQUIRED_NAME = 'לפריט ברכש חייב להיות שם, אחרת אי אפשר לדעת מה מחפשים';
export const REQUIRED_QUANTITY = 'הכמות הדרושה חייבת להיות מספר שלם, אחד או יותר';
export const REQUIRED_LENDER = 'להשאלה מחבר קאמפ צריך לבחור ממי משאילים, אחרת לא יהיה למי להחזיר';
export const REQUIRED_LOCATION = 'צריך לרשום מיקום במחסן, אחרת אי אפשר יהיה למצוא את הפריט בשנה הבאה';

export const ACQUISITION_ERRORS: HebrewErrors = [
  ['an acquisition must have a name', REQUIRED_NAME],
  ['an acquisition quantity', REQUIRED_QUANTITY],
  ['a borrowed acquisition must name the lender', REQUIRED_LENDER],
  ['unknown acquisition', 'לא מצאנו את הפריט הזה ברשימת הרכש'],
  ['unknown category', 'הקטגוריה הזו אינה אחת מחמש הקטגוריות האפשריות'],
  ['unknown source', 'דרך ההשגה הזו אינה אחת משלוש האפשרויות'],
  ['unknown status', 'הסטטוס הזה אינו אחד מארבעת הסטטוסים האפשריים'],
];

/**
 * The arrival decision fails in its own ways, and in the warehouse's as well —
 * it writes an inventory row. Both vocabularies are here, so that the same
 * refusal is worded identically wherever a lead meets it.
 *
 * `is already registered` is the one that needs its full sentence: a lead who
 * hits it has almost certainly pressed the button twice, and "we already have
 * this one" is more useful than any refusal phrased as a rule.
 */
export const ARRIVAL_ERRORS: HebrewErrors = [
  ...ACQUISITION_ERRORS,
  ['an arriving quantity', 'הכמות שנכנסת למחסן חייבת להיות מספר שלם, אחד או יותר'],
  ['an inventory item must have a location', REQUIRED_LOCATION],
  ['an inventory item must have a name', 'לפריט במחסן חייב להיות שם'],
  ['unknown inventory item', 'לא מצאנו את הפריט הזה במחסן'],
  ['unknown condition', 'המצב הזה אינו אחד מארבעת המצבים האפשריים'],
  [
    'acquisition',
    'הפריט הזה כבר נרשם למחסן. אפשר לפתוח אותו מהמחסן ולעדכן שם את הכמות.',
  ],
];

export function acquisitionFailureMessage(error: unknown): string {
  return toHebrewError(error, ACQUISITION_ERRORS);
}

export function arrivalFailureMessage(error: unknown): string {
  return toHebrewError(error, ARRIVAL_ERRORS);
}
