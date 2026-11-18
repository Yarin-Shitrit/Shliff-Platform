import type { AccountFund, AccountKind } from '@/db/schema/money';

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

/**
 * The camp's two pots, in the order every screen lists them. Dues pay for
 * the camp; the parties raise money for the gift. They are kept apart
 * everywhere a balance is shown, because a shekel of one is not a shekel of
 * the other and their sum is a quantity of nothing.
 */
export const ACCOUNT_FUNDS: readonly AccountFund[] = ['camp', 'gift'];

/** As a tag: on a card, in a picker, in a table cell. */
export const ACCOUNT_FUND_LABELS: Record<AccountFund, string> = {
  camp: 'קאמפ',
  gift: 'גיפט',
};

/** With the article: as a heading, and inside a sentence. */
export const ACCOUNT_FUND_NAMES: Record<AccountFund, string> = {
  camp: 'הקאמפ',
  gift: 'הגיפט',
};

/** What each pot is for — the sentence beside the choice in a form. */
export const ACCOUNT_FUND_PURPOSE: Record<AccountFund, string> = {
  camp: 'דמי הקאמפ וההוצאות של המחנה',
  gift: 'כסף המסיבות, בשביל הגיפט',
};

/** An account nobody has placed in a pot yet. */
export const NO_FUND_LABEL = 'לא נקבע';
/** The same, as the heading of a group of such accounts. */
export const NO_FUND_GROUP_LABEL = 'לא נקבע של מי הכסף';

export function isAccountFund(value: unknown): value is AccountFund {
  return value === 'camp' || value === 'gift';
}

/**
 * The pot a stored value names, or null. The column is `text` with a
 * TypeScript type over it, so anything that is neither pot is read as
 * "nobody has placed it" — the account then shows up as a decision to make
 * instead of matching no group and vanishing from the screen.
 */
export function fundOf(value: unknown): AccountFund | null {
  return isAccountFund(value) ? value : null;
}

export function fundLabel(fund: AccountFund | null): string {
  const known = fundOf(fund);
  return known === null ? NO_FUND_LABEL : ACCOUNT_FUND_LABELS[known];
}

export interface FundGroup<T> {
  fund: AccountFund | null;
  /** The heading: `הקאמפ`, `הגיפט`, or the unplaced group's own. */
  label: string;
  rows: T[];
}

/**
 * Rows split by pot, for a list or a picker: `first`'s pot, then the other,
 * then the accounts nobody has placed. A group with nothing in it is left
 * out rather than drawn empty. Within a group the rows keep the order they
 * came in.
 *
 * `first` is the pot the screen is about — the camp's on the dues screen, the
 * gift's on a party's page — so the likely choice is the one on top. It
 * reorders, and never selects: which account money went to is the lead's to
 * say.
 */
export function groupByFund<T extends { fund: AccountFund | null }>(
  rows: readonly T[], first: AccountFund = 'camp',
): Array<FundGroup<T>> {
  const order: Array<AccountFund | null> = [
    first, ...ACCOUNT_FUNDS.filter((fund) => fund !== first), null,
  ];
  return order
    .map((fund) => ({
      fund,
      label: fund === null ? NO_FUND_GROUP_LABEL : ACCOUNT_FUND_NAMES[fund],
      rows: rows.filter((row) => fundOf(row.fund) === fund),
    }))
    .filter((group) => group.rows.length > 0);
}

/**
 * The sentence a form shows when money of one pot is about to be filed under
 * an account of the other — dues into the gift's account, a party's takings
 * into the camp's. Null when there is nothing to say: no account chosen, an
 * account nobody has placed, or the pot the money belongs to.
 *
 * A note, never a refusal. The camp does sometimes hold one pot's money in the
 * other's account for a while, and the lead is the one who knows; what the
 * form owes them is to say what the choice means before it is saved.
 * `claim` is the form's own half of the sentence — `דמי קאמפ הם כסף של הקאמפ`.
 */
export function otherPotNote(
  account: { name: string; fund: AccountFund | null } | null | undefined,
  expected: AccountFund,
  claim: string,
): string | null {
  const fund = account ? fundOf(account.fund) : null;
  if (!account || fund === null || fund === expected) return null;
  return `${claim}, ו־${account.name} רשום כחשבון של ${ACCOUNT_FUND_NAMES[fund]}.`;
}
