import { toHebrewError, type HebrewErrors } from '@/lib/errors/hebrew';

/**
 * R9: no English reaches a Hebrew screen. Mapped here, at the action
 * boundary, with the maps as arguments rather than a registry (§5 A7).
 *
 * `a material may point at stock or at an order, not at both` gets a sentence
 * that explains the consequence rather than restating the rule: a lead who
 * hits it has just told the screen two different things about where one thing
 * is coming from, and the useful reply names that.
 */
export const MATERIAL_ERRORS: HebrewErrors = [
  ['a material must have a name', 'לחומר חייב להיות שם, אחרת אי אפשר לדעת מה צריך'],
  ['a material quantity', 'הכמות הדרושה חייבת להיות מספר שלם, אחד או יותר'],
  [
    'a material may point at stock or at an order',
    'אפשר לקשר את החומר או לפריט במחסן או לפריט ברכש — לא לשניהם. מצב החומר מחושב מהקישור, ושני קישורים הם שתי תשובות סותרות.',
  ],
  ['unknown build task', 'לא מצאנו את משימת ההקמה הזו'],
  ['unknown material', 'לא מצאנו את החומר הזה ברשימה'],
  ['unknown inventory item', 'לא מצאנו את הפריט הזה במחסן'],
  ['unknown acquisition', 'לא מצאנו את הפריט הזה ברשימת הרכש'],
];

export function materialFailureMessage(error: unknown): string {
  return toHebrewError(error, MATERIAL_ERRORS);
}
