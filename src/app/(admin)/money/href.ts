import { closePeekHref, openActHref, type ReadableParams } from '@/components/ui/drawer-url';

/**
 * Every link /money produces to itself, from one place.
 *
 * A drawer is a URL (R6) and the season is global (R5), so "count קופת מזומן,
 * for ברן 26" is a thing a lead can paste into a message. The drawer itself
 * is `?act=<verb>` built through the kit's `openActHref`/`closePeekHref`
 * (A3), so `esc`, the close control and the back button read the same param
 * every other drawer in the app handles.
 *
 * The count drawer names its account in `account=`, beside `act=count`. It
 * is a create-shaped drawer rather than a `peek`: the account has no
 * record page to peek at, and the drawer writes rather than shows.
 */
export const MONEY_PATH = '/money';

export interface MoneyHrefParts {
  season: string;
  /** The account whose balance is being counted: `?act=count&account=<id>`. */
  count?: string;
  /** The new-account drawer: `?act=new-account`. */
  newAccount?: boolean;
}

export function moneyHref(parts: MoneyHrefParts): string {
  const current: ReadableParams = [['season', parts.season]];
  // One drawer at a time: two overlapping panels have no sensible layout.
  if (parts.count) {
    return openActHref(MONEY_PATH, [...current, ['account', parts.count]], 'count');
  }
  if (parts.newAccount) return openActHref(MONEY_PATH, current, 'new-account');
  return closePeekHref(MONEY_PATH, current);
}
