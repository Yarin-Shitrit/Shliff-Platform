import type { ExpenseCategory } from '@/db/schema/money';

/**
 * The short list an expense is filed under on /money/expenses, in the order
 * the form shows it. `אחר` is last and is a choice like the others: a blank
 * category means nobody chose, which is not the same thing.
 *
 * No database import here on purpose — the phone form is a client component
 * and reads this file.
 */
export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  'food', 'gear', 'build', 'transport', 'power', 'sound', 'storage', 'other',
];

export const EXPENSE_CATEGORY_LABELS: Readonly<Record<ExpenseCategory, string>> = {
  food: 'אוכל ושתייה',
  gear: 'ציוד',
  build: 'בנייה וחומרים',
  transport: 'הובלות ורכב',
  power: 'חשמל ודלק',
  sound: 'סאונד ותאורה',
  storage: 'אחסון',
  other: 'אחר',
};

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return typeof value === 'string' && (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}
