'use client';

/**
 * The footer of the open block: what promoting it would do, the one button
 * that does it, and the way past it without writing.
 *
 * A client component because pressing this writes, reports what it wrote, and
 * then moves the lead on. It receives the pre-flight counts as props — the page
 * computed them server-side from one dry run — so it fetches nothing of its own.
 *
 * The button carries the number it is about to write, and drops it the moment
 * the draft stops describing those counts. A stale count is worse than no
 * count: promising 52 rows while a lead has just unmapped the amount column
 * would be the screen lying about the only number on it.
 */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnMapping } from '@/lib/classify/map-columns';
import type { BlockArchetype } from '@/lib/classify/types';
import type { BudgetCategory } from '@/db/schema/money';
import type { PromotionSummary } from '@/lib/import/review';
import { confirmAndPromoteAction } from './actions';
import styles from './import-review.module.css';

export function PromoteBar(
  { uploadId, blockId, archetype, preflight, draft, budgetCategory, dirty, nextBlockId }: {
    uploadId: string;
    blockId: string;
    archetype: BlockArchetype;
    /** The counts the dry run produced for the mapping the server holds. */
    preflight: PromotionSummary;
    draft: ColumnMapping[];
    /** The lead's budget decision, carried so confirming cannot reset it. */
    budgetCategory: BudgetCategory | null;
    /** True while the draft differs from what those counts describe. */
    dirty: boolean;
    /** The next block still wanting a human, or null when this is the last. */
    nextBlockId: string | null;
  },
) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [wrote, setWrote] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onPromote() {
    setError(null);
    setWrote(null);
    setFinished(false);
    startTransition(async () => {
      const outcome = await confirmAndPromoteAction(
        blockId, archetype, draft, budgetCategory,
      );
      if (!outcome.ok) {
        setError(outcome.message);
        return;
      }
      /* E2: a write is never silent, and finishing the file must not swallow
       * the report of what finishing it wrote. */
      setWrote(`נכתבו ${outcome.summary.written} שורות · ${outcome.summary.refused} נדחו`);
      if (outcome.nextBlockId) {
        router.push(`/imports/${uploadId}?block=${outcome.nextBlockId}`);
      } else {
        setFinished(true);
      }
    });
  }

  return (
    <footer className={styles.promoteBar}>
      {/* A17: one isolate per clause, each a phrase of its own. */}
      <span className={styles.preflight}>
        {dirty ? 'הספירה תתעדכן אחרי השמירה' : (
          <>
            <bdi>ייכתבו {preflight.written} שורות</bdi>
            {' · '}
            <bdi>{preflight.refused} יידחו עם סיבה</bdi>
            {' · '}
            <bdi>{preflight.noted} ייכתבו עם הערה וימתינו לטיפול</bdi>
          </>
        )}
      </span>

      <span className={styles.grow} />

      {wrote || finished ? (
        <span role="status" className={styles.doneNote}>
          {wrote ? <bdi>{wrote}</bdi> : null}
          {finished ? <span className={styles.finished}>אין טבלאות שממתינות לבדיקה</span> : null}
        </span>
      ) : null}
      {error ? <span role="alert" className={styles.errorNote}>{error}</span> : null}

      {nextBlockId ? (
        <Link className={styles.secondary} href={`/imports/${uploadId}?block=${nextBlockId}`}>
          דילוג
        </Link>
      ) : null}
      <button
        type="button"
        className={styles.primary}
        onClick={onPromote}
        disabled={pending}
      >
        {pending ? 'מקדם…' : dirty
          ? 'אישור וקידום'
          : <bdi>אישור וקידום {preflight.written} שורות</bdi>}
      </button>
    </footer>
  );
}
