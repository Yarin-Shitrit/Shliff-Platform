'use client';

/**
 * Promote every confirmed table of THIS file, and only this file.
 *
 * `promoteUploadAction` composes `promoteBlock` over one upload's blocks; it
 * does not call `promoteAll`, and nothing on this screen may. Re-promoting one
 * known block re-inserts two rows the promoter fabricates from a summary
 * sub-table which together are exactly ברן 26's whole budget, so a
 * whole-database promotion doubles it and cannot be repaired afterwards.
 *
 * The confirmation is not ceremony. What makes this control safe is that a
 * lead consented to a named count in a named file, so the dialog says both
 * before anything is written.
 */
import { useState, useTransition } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Icon } from '@/components/ui/icon';
import { promoteUploadAction } from './actions';
import styles from './import-review.module.css';

export function PromoteUploadButton(
  { uploadId, confirmedCount }: { uploadId: string; confirmedCount: number },
) {
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();
  const [wrote, setWrote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onConfirm() {
    setAsking(false);
    setError(null);
    setWrote(null);
    startTransition(async () => {
      const outcome = await promoteUploadAction(uploadId);
      if (!outcome.ok) {
        setError(outcome.message);
        return;
      }
      setWrote(`נכתבו ${outcome.summary.written} שורות · ${outcome.summary.refused} נדחו`);
    });
  }

  return (
    <div className={styles.bulkPromote}>
      <button
        type="button"
        className={styles.primary}
        onClick={() => setAsking(true)}
        disabled={pending}
      >
        <Icon name="check" size={14} />
        {/* A17: one isolate for the whole phrase. */}
        <bdi>{pending ? 'מקדם…' : `קידום ${confirmedCount} טבלאות מאושרות`}</bdi>
      </button>

      {wrote ? <span role="status" className={styles.doneNote}><bdi>{wrote}</bdi></span> : null}
      {error ? <span role="alert" className={styles.errorNote}>{error}</span> : null}

      {asking ? (
        <ConfirmDialog
          title="לקדם את הטבלאות המאושרות של הקובץ הזה?"
          consequence={(
            <bdi>
              {`${confirmedCount} טבלאות ייכתבו לנתוני הקאמפ. `}
              רק הטבלאות של הקובץ הזה — שום קובץ אחר לא ייגע.
            </bdi>
          )}
          confirmLabel="קידום הטבלאות"
          cancelLabel="חזרה"
          onCancel={() => setAsking(false)}
          onConfirm={onConfirm}
        />
      ) : null}
    </div>
  );
}
