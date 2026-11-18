/**
 * Every sentence /money/expenses can refuse with. In a file of their own, with
 * no database import, because the phone form is a client component and says
 * the first few itself before it sends anything.
 */

/** Verbatim on the screen: the form checks the same things before it sends,
 *  in these words, so the two cannot say different things. */
export const EXPENSE_REFUSALS = {
  amount: 'הקלידו את הסכום ששולם, בשקלים',
  description: 'כתבו בכמה מילים על מה ההוצאה',
  noDate: 'להוצאה חייב להיות תאריך',
  pickAccount: 'בחרו מאיזה חשבון שולם',
  noAccount: 'החשבון שנבחר לא קיים',
  closedAccount: 'החשבון שנבחר נסגר. בחרו חשבון אחר.',
  pickSeason: 'בחרו לאיזו שנה ההוצאה שייכת',
  noSeason: 'השנה שנבחרה לא קיימת',
  category: 'הקטגוריה שנבחרה לא קיימת',
  receipt: 'תמונת הקבלה לא נשמרה כמו שצריך. צלמו אותה שוב.',
  missing: 'ההוצאה הזו כבר לא קיימת. רעננו את הדף.',
  notYours: 'אפשר למחוק מכאן רק הוצאה שרשמתם בעצמכם',
} as const;

/** The upload route's own refusals: what can go wrong with the request and
 *  the photo, before the library is asked anything. */
export const RECORD_REFUSALS = {
  unauthorized: 'אין הרשאה',
  unreadable: 'הטופס לא הגיע בשלמותו. נסו שוב.',
  tooLarge: 'תמונת הקבלה גדולה מדי. צלמו אותה שוב, או רשמו את ההוצאה בלי תמונה.',
  notAPicture: 'הקובץ שצורף אינו תמונה. צרפו צילום של הקבלה.',
  storage: 'תמונת הקבלה לא נשמרה, ולכן גם ההוצאה לא נרשמה. נסו שוב, או רשמו בלי תמונה.',
  /** The form's own, for a request that never got an answer. */
  offline: 'ההוצאה לא נשלחה. בדקו את הקליטה ונסו שוב — מה שהקלדתם נשאר כאן.',
} as const;
