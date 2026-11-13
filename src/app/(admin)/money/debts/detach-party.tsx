'use client';

/**
 * The control that cuts a debt's link to a person while keeping the debt.
 *
 * It exists for one flow: a person being deleted. `deletePerson` refuses
 * while a debt names them, and until this control there was nothing on any
 * screen that could change that — the delete drawer pointed at /money/debts,
 * where a linked debt could be settled but never re-pointed. The debt is
 * not moved to anybody else and nothing about it is forgotten: its party
 * becomes the same name as free text, which `רישום למי החוב` can link again.
 *
 * A client component for the confirmation (R8: an irreversible-looking
 * change names its consequence before the button) and the refresh after.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toaster';
import { detachObligationPartyAction } from './actions';
import styles from './debts.module.css';

export const DETACH_LABEL = 'ניתוק מהאדם';

export function DetachParty({ obligationId, displayParty, description }: {
  obligationId: string;
  displayParty: string;
  description: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function detach() {
    setConfirming(false);
    setError(null);
    setPending(true);
    try {
      const result = await detachObligationPartyAction(obligationId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.show({ message: `החוב ״${description}״ כבר לא מקושר לרשומה של ${displayParty}; השם נשאר עליו כטקסט.` });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.detach}>
      <p className={styles.detachNote}>
        החוב מקושר לרשומה של <bdi>{displayParty}</bdi>. כדי למחוק את הרשומה הזו מרשימת האנשים,
        מנתקים את החוב ממנה קודם — החוב עצמו נשאר רשום, על אותו שם.
      </p>
      <Button tone="ghost" size="sm" disabled={pending} onClick={() => { setConfirming(true); }}>
        {DETACH_LABEL}
      </Button>
      {error === null ? null : <p className={styles.formError} role="alert">{error}</p>}
      {confirming ? (
        <ConfirmDialog
          title="ניתוק החוב מהאדם"
          consequence={(
            <>
              החוב ״<bdi>{description}</bdi>״ יישאר רשום על השם <bdi>{displayParty}</bdi> כטקסט חופשי,
              בלי קישור לרשומה שלו. הסכום, מה שנסגר ממנו והתנועות לא משתנים.
            </>
          )}
          confirmLabel={DETACH_LABEL}
          tone="default"
          onCancel={() => { setConfirming(false); }}
          onConfirm={detach}
        />
      ) : null}
    </div>
  );
}
