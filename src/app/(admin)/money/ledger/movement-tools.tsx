'use client';

/**
 * Client component because removing a movement is confirmed before it is
 * written, and the library's refusal has to land on the row it is about.
 * Correcting one is a link — the drawer is a URL (R6) — so only the removal
 * holds state here.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ButtonLink } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/format';
import { deleteMovementAction } from './actions';
import styles from './ledger.module.css';

/** Correct and remove, for a movement a lead typed. The page offers this only
 *  where `entryIsOpen` holds; the library refuses the rest, and says why. */
export function MovementTools({
  movementId, description, amountAgorot, balanceOf, editHref,
}: {
  movementId: string;
  description: string;
  amountAgorot: number;
  /** The account whose balance the removal will change, or null when it will
   *  change none — said in the confirmation either way. */
  balanceOf: string | null;
  editHref: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setConfirming(false);
    setPending(true);
    try {
      const result = await deleteMovementAction(movementId);
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
      {/* The description is in each name: a column of these is otherwise a
        * column of identical buttons to a screen reader. */}
      <ButtonLink tone="ghost" size="sm" iconLabel={`תיקון ${description}`} href={editHref}>
        <Icon name="pencil" size={15} />
      </ButtonLink>
      <Button
        tone="ghost" size="sm" iconLabel={`מחיקת ${description}`}
        disabled={pending} onClick={() => { setConfirming(true); }}
      >
        <Icon name="trash" size={15} />
      </Button>
      {error === null ? null : <span className={styles.formError} role="alert">{error}</span>}
      {confirming ? (
        <ConfirmDialog
          title="מחיקת תנועה"
          confirmLabel="מחיקת התנועה"
          tone="danger"
          onCancel={() => { setConfirming(false); }}
          onConfirm={remove}
          consequence={(
            <>
              {'התנועה ״'}<bdi>{description}</bdi>{'״ על סך '}<Money agorot={amountAgorot} />
              {' תימחק מהתנועות, ואי אפשר יהיה לשחזר אותה. '}
              {balanceOf === null
                ? 'היתרה של החשבונות לא תשתנה.'
                : <>{'היתרה של '}<bdi>{balanceOf}</bdi>{' תשתנה בהתאם.'}</>}
            </>
          )}
        />
      ) : null}
    </span>
  );
}
