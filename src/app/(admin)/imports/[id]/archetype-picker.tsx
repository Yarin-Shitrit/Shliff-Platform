'use client';

/**
 * A client component because picking a type is a write that has to report what
 * it did and then make the page re-read itself. It deliberately keeps no
 * draft: the selected value is the block's stored archetype, and a failed
 * change leaves the old one on screen rather than a type nobody saved.
 *
 * Changing the type IS confirming it — `applyConfirmation` is the only path
 * that recomputes a column map for a new archetype, and it also stamps
 * `confirmedBy`/`confirmedAt`. Rather than pretend otherwise, the hint says so.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BLOCK_ARCHETYPES, type BlockArchetype } from '@/lib/classify/types';
import { confidenceWord, type ConfidenceWord } from '@/lib/classify/field-labels';
import { refusalMessage } from '@/lib/import/sheet-labels';
import { Pill, type PillTone } from '@/components/ui/pill';
import { ARCHETYPE_LABELS } from '../labels';
import { confirmBlock } from './actions';
import styles from './import-review.module.css';

/** R3: the word carries the meaning; the tone is the second signal. */
const CONFIDENCE_TONE: Record<ConfidenceWord, PillTone> = {
  'בטוח': 'ok',
  'כנראה': 'warn',
  'לא בטוח': 'warn',
};

export function ArchetypePicker(
  { blockId, archetype, confidence }: {
    blockId: string; archetype: BlockArchetype; confidence: number;
  },
) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const word = confidenceWord(confidence);

  function onChange(next: BlockArchetype) {
    if (next === archetype) return;
    setError(null);
    startTransition(async () => {
      try {
        /**
         * An empty map on purpose. `applyConfirmation` discards whatever map
         * it is handed when the archetype changed and recomputes it from the
         * block's own grid, so sending the old archetype's map would be
         * sending something the server must throw away. The refresh below is
         * how the recomputed map reaches the screen — the UI re-reads, it
         * never re-sends.
         */
        await confirmBlock(blockId, next, []);
        router.refresh();
      } catch (cause) {
        setError(refusalMessage(cause));
      }
    });
  }

  return (
    <div className={styles.picker}>
      <label className={styles.pickerLabel} htmlFor={`archetype-${blockId}`}>
        סוג הטבלה
      </label>
      <select
        id={`archetype-${blockId}`}
        className={styles.pickerSelect}
        value={archetype}
        disabled={pending}
        onChange={(event) => onChange(event.target.value as BlockArchetype)}
      >
        {BLOCK_ARCHETYPES.map((option) => (
          <option key={option} value={option}>{ARCHETYPE_LABELS[option]}</option>
        ))}
      </select>
      <Pill tone={CONFIDENCE_TONE[word]}>{word}</Pill>
      <p className={styles.pickerHint}>
        שינוי הסוג מאשר אותו ומחשב מחדש את התאמת העמודות.
      </p>
      {error ? <p className={styles.errorNote} role="alert">{error}</p> : null}
    </div>
  );
}
