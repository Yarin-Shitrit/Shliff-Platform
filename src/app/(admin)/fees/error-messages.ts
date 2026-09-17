import type { HebrewErrors } from '@/lib/errors/hebrew';

/**
 * Every English message the dues libraries throw, in the order they are
 * matched. Prefixes, because three of them interpolate an id.
 *
 * The first, seventh and eighth entries are reused verbatim from the copy that
 * already stood on this screen — `exception-form.tsx:43`,
 * `member-fee-row.tsx:128` and `member-fee-row.tsx:132` — because a lead has
 * already learned to read them (E5).
 */
export const FEE_ERRORS: HebrewErrors = [
  ['an exception must carry a reason',
    'חריג חייב לכלול סיבה. בלי זה אי אפשר יהיה לדעת בעוד שנה למה.'],
  ['an exception must record who decided it',
    'חריג חייב לרשום מי החליט עליו.'],
  ['an exception amount may not be negative',
    'הסכום חייב להיות מספר שאינו שלילי.'],
  ['no due for that person in that season — issue the flat dues first',
    'אין חיוב לאדם הזה בשנה הזאת. הנפיקו קודם חיוב לפי התעריף הרגיל.'],
  ['no due for that person in that season — nothing to clear',
    'אין חיוב לאדם הזה בשנה הזאת, ולכן אין חריג לבטל.'],
  ['that person is not on this season roster',
    'האדם הזה לא ברשימת החברים של השנה הזאת.'],
  ['a payment amount must be positive',
    'סכום התשלום חייב להיות מספר חיובי.'],
  ['an offset must carry a note saying what it was set against',
    'קיזוז חייב לכלול הערה שמסבירה מול מה הוא קוזז — אחרת אי אפשר לדעת בעתיד.'],
  ['an offset needs at least one due',
    'קיזוז צריך לכלול לפחות חיוב אחד.'],
  ['unknown payment channel',
    'אמצעי התשלום הזה לא מוכר.'],
  ['unknown season',
    'השנה הזאת לא נמצאה.'],
  ['unknown due',
    'החיוב הזה לא נמצא.'],
];
