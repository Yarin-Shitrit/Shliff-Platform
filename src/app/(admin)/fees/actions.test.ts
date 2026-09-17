import { describe, it, expect } from 'vitest';
import { toHebrewError, HEBREW_FALLBACK } from '@/lib/errors/hebrew';
import { FEE_ERRORS } from './error-messages';

/**
 * Each case is the exact string thrown by `src/lib/fees/dues.ts` or
 * `src/lib/fees/payments.ts`. If one of those messages is ever reworded, this
 * test is what catches the mapping going stale.
 */
const THROWN: Array<[string, string]> = [
  ['an exception must carry a reason',
    'חריג חייב לכלול סיבה. בלי זה אי אפשר יהיה לדעת בעוד שנה למה.'],
  ['an exception must record who decided it', 'חריג חייב לרשום מי החליט עליו.'],
  ['an exception amount may not be negative', 'הסכום חייב להיות מספר שאינו שלילי.'],
  ['no due for that person in that season — issue the flat dues first',
    'אין חיוב לאדם הזה בשנה הזאת. הנפיקו קודם חיוב לפי התעריף הרגיל.'],
  ['no due for that person in that season — nothing to clear',
    'אין חיוב לאדם הזה בשנה הזאת, ולכן אין חריג לבטל.'],
  ['that person is not on this season roster',
    'האדם הזה לא ברשימת החברים של השנה הזאת.'],
  ['a payment amount must be positive', 'סכום התשלום חייב להיות מספר חיובי.'],
  ['an offset must carry a note saying what it was set against',
    'קיזוז חייב לכלול הערה שמסבירה מול מה הוא קוזז — אחרת אי אפשר לדעת בעתיד.'],
  ['an offset needs at least one due', 'קיזוז צריך לכלול לפחות חיוב אחד.'],
  ['unknown payment channel: bitcoin', 'אמצעי התשלום הזה לא מוכר.'],
  ['unknown season 8f2b1c4e-0000-4000-8000-000000000001', 'השנה הזאת לא נמצאה.'],
  ['unknown due 8f2b1c4e-0000-4000-8000-000000000002', 'החיוב הזה לא נמצא.'],
];

describe('FEE_ERRORS', () => {
  it.each(THROWN)('maps %s', (thrown, hebrew) => {
    expect(toHebrewError(new Error(thrown), FEE_ERRORS)).toBe(hebrew);
  });

  it('lets the already-Hebrew קיזוז refusal through unchanged', () => {
    const hebrew = 'קיזוז אינו מזיז מזומן, ולכן אינו נכנס לחשבון';
    expect(toHebrewError(new Error(hebrew), FEE_ERRORS)).toBe(hebrew);
  });

  it('renders the generic Hebrew fallback for a message nobody mapped', () => {
    expect(toHebrewError(new Error('relation "dues" does not exist'), FEE_ERRORS))
      .toBe(HEBREW_FALLBACK);
  });

  it('contains no Latin letters in any Hebrew message it produces', () => {
    for (const [, hebrew] of FEE_ERRORS) expect(hebrew).not.toMatch(/[A-Za-z]/);
    expect(HEBREW_FALLBACK).not.toMatch(/[A-Za-z]/);
  });
});
