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
  { uploadId, confirmedCount, alreadyPromoted }: {
    uploadId: string;
    /**
     * Every block `promoteUpload` will touch — state `confirmed` OR
     * `promoted`, because W4/W5 make a re-run the way a lead fixes a column
     * map. Counting only the unwritten ones would name one table and rewrite
     * four; on the camp's first workbook today that is exactly 1 against 4.
     */
    confirmedCount: number;
    /** How many of those have already written rows, and will write them again. */
    alreadyPromoted: number;
  },
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
            <>
              {/* A17: one isolate per phrase, and the re-write is said out
                  loud rather than left to be inferred from a count. */}
              <bdi>{`${confirmedCount} טבלאות ייכתבו לנתוני הקאמפ. `}</bdi>
              {alreadyPromoted > 0
                ? <bdi>{`${alreadyPromoted} מתוכן כבר קודמו, והשורות שלהן ייכתבו מחדש. `}</bdi>
                : null}
              רק הטבלאות של הקובץ הזה — שום קובץ אחר לא ייגע.
            </>
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
