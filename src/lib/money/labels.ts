import type { AccountKind } from '@/db/schema/money';

/**
 * The four kinds of place money sits, in the words the screens use. A plain
 * data module so that a Server Component (the account card) and a client
 * form (the new-account drawer) read the same table across the boundary —
 * the shape `client-boundary.test.ts` asks for.
 */
export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  cash: 'מזומן',
  bank: 'בנק',
  personal: 'חשבון פרטי',
  event_float: 'קופת אירוע',
};
