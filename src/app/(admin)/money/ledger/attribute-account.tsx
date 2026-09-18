'use client';

/**
 * Client component because it holds an unsubmitted choice and renders the
 * action's refusal in place. A Server Component can do neither: the select
 * has to remember which קופה is picked before anything is written, and the
 * refusal has to land on this row rather than at the top of the page —
 * a page of unattributed movements would otherwise show one message with no
 * way to tell which row it was about.
 *
 * Two kit gaps meet here. There is no select control (§5 A28), and the kit's
 * `Field` has no way to hide its label, which a control living in a table
 * cell needs: a visible `שיוך מים וקרח לחשבון` above every row would be
 * eleven labels in a column eleven rows tall. So this is a native `<select>`
 * carrying its own `aria-label`, styled from this screen's module against the
 * same tokens `field.module.css` uses. Both gaps are reported, not patched —
 * the kit is read-only here.
 */

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { attributeMovementAction } from './actions';
import styles from './ledger.module.css';

/** Never a real account id, and never a value the action could accept. */
const UNCHOSEN = '';

export function AttributeAccount({ origin, movementId, description, accounts }: {
  origin: 'ledger' | 'dues';
  movementId: string;
  description: string;
  accounts: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const errorId = useId();
  const [accountId, setAccountId] = useState(UNCHOSEN);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * An empty register of accounts is not a select with nothing in it. A
   * control that cannot succeed says why, rather than inviting a click that
   * always fails.
   */
  if (accounts.length === 0) {
    return <span className={styles.noAccounts}>אין חשבונות להקצות אליהם</span>;
  }

  async function attribute() {
    // Checked here as well as in the library because the placeholder is a
    // real value of a real select. Without this, submitting an untouched row
    // would reach the action with an empty id and come back refusing an
    // account that does not exist — true, but not the reason, and a lead
    // would go looking for a missing קופה instead of picking one.
    if (accountId === UNCHOSEN) {
      setError('בחרו חשבון לפני השיוך');
      return;
    }
    setError(null);
    setPending(true);
    try {
      const result = await attributeMovementAction({ origin, id: movementId, accountId });
      if (result.ok) router.refresh();
      else setError(result.error);
    } finally {
      setPending(false);
    }
  }

  return (
    <span className={styles.attribute}>
      {/* The movement's own description is in the name: the בלי חשבון view is
        * a column of these controls, and `שיוך לחשבון` repeated tells a
        * screen reader nothing about which shekel it is placing. */}
      <select
        className={styles.select}
        aria-label={`שיוך ${description} לחשבון`}
        aria-invalid={error !== null ? true : undefined}
        aria-errormessage={error !== null ? errorId : undefined}
        value={accountId}
        disabled={pending}
        onChange={(event) => { setAccountId(event.target.value); }}
      >
        <option value={UNCHOSEN}>בחרו חשבון</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>{account.name}</option>
        ))}
      </select>
      <Button size="sm" onClick={attribute} disabled={pending}>שיוך</Button>
      {error === null ? null : (
        <p className={styles.formError} id={errorId} role="alert">{error}</p>
      )}
    </span>
  );
}
