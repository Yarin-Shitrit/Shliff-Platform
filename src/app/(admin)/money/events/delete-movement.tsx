'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/format';
import { deletePartyMovementAction } from './actions';
import styles from './events.module.css';

/** The way back from a wrong line. Only offered on a line a lead typed; the
 *  library refuses the rest, and says why. */
export function DeleteMovement({
  eventId, entryId, description, amountAgorot,
}: {
  eventId: string;
  entryId: string;
  description: string;
  amountAgorot: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setConfirming(false);
    setPending(true);
    try {
      const result = await deletePartyMovementAction(eventId, entryId);
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
    <span className={styles.rowAction}>
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
          onCancel={() => { setConfirming(false); }}
          onConfirm={remove}
          consequence={(
            <>
              {'התנועה ״'}<bdi>{description}</bdi>{'״ על סך '}<Money agorot={amountAgorot} />
              {' תימחק מהמסיבה ומהתנועות, ותצא מהיתרה של החשבון שלה.'}
            </>
          )}
        />
      ) : null}
    </span>
  );
}
