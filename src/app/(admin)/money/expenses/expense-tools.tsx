'use client';

/**
 * What one row of "the expenses you recorded" offers: remove it, and — for an
 * account that may also edit the ledger — the link to correct it there.
 * Client component because the removal is confirmed before it is written.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ButtonLink } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/format';
import { deleteExpenseAction } from './actions';
import styles from './expenses.module.css';

export function ExpenseTools({
  expenseId, description, amountAgorot, accountName, editHref,
}: {
  expenseId: string;
  description: string;
  amountAgorot: number;
  accountName: string | null;
  /** The ledger's correction drawer for this movement; null for an account
   *  that may not edit the ledger, which gets no link it cannot follow. */
  editHref: string | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setConfirming(false);
    setPending(true);
    try {
      const result = await deleteExpenseAction(expenseId);
      if (result.ok) {
        setError(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <span className={styles.tools}>
      {editHref === null ? null : (
        <ButtonLink tone="ghost" size="sm" iconLabel={`תיקון ${description} בתנועות`} href={editHref}>
          <Icon name="pencil" size={15} />
        </ButtonLink>
      )}
      <Button
        tone="ghost" size="sm" iconLabel={`מחיקת ${description}`}
        disabled={pending} onClick={() => { setConfirming(true); }}
      >
        <Icon name="trash" size={15} />
      </Button>
      {error === null ? null : <span className={styles.formError} role="alert">{error}</span>}
      {confirming ? (
        <ConfirmDialog
          title="מחיקת הוצאה"
          confirmLabel="מחיקת ההוצאה"
          tone="danger"
          onCancel={() => { setConfirming(false); }}
          onConfirm={remove}
          consequence={(
            <>
              {'ההוצאה ״'}<bdi>{description}</bdi>{'״ על סך '}<Money agorot={amountAgorot} />
              {' תימחק מהתנועות, ואי אפשר יהיה לשחזר אותה. '}
              {accountName === null
                ? null
                : <>{'היתרה של '}<bdi>{accountName}</bdi>{' מתעדכנת בהתאם.'}</>}
            </>
          )}
        />
      ) : null}
    </span>
  );
}
