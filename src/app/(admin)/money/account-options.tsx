import type { AccountFund } from '@/db/schema/money';
import { groupByFund } from '@/lib/money/labels';

/** An account as a picker needs it: enough to name it and to say whose
 *  money it holds. */
export interface AccountChoice {
  id: string;
  name: string;
  fund: AccountFund | null;
}

/**
 * The `<option>`s of an account picker, under a heading per pot.
 *
 * Every form that asks "which account" is also asking "whose money", because
 * the account is the only place the pot is recorded. A flat list of names
 * hides that: `עו״ש אופק` and `וייבז קלוז פרינדס` look like two interchangeable
 * places to put a payment, and a camp expense filed under the gift's account
 * overdraws the wrong pot without a word. Grouped, the choice says what it
 * means before it is made.
 *
 * `first` puts one pot's accounts on top — the gift's on a party's page. It
 * reorders and never selects: the forms keep their own empty first option.
 *
 * No `'use client'`: it holds no state and takes no handlers, so it renders
 * inside the client forms that import it and inside a Server Component alike.
 * These are native `<optgroup>`s because every form here already draws a
 * native `<select>` (§5 A28).
 */
export function AccountOptions({ accounts, first }: {
  accounts: readonly AccountChoice[];
  first?: AccountFund;
}) {
  return (
    <>
      {groupByFund(accounts, first).map((group) => (
        <optgroup key={group.fund ?? 'unplaced'} label={group.label}>
          {group.rows.map((account) => (
            <option key={account.id} value={account.id}>{account.name}</option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
