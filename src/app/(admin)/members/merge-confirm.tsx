'use client';

/**
 * The second and last client component this screen adds, and it holds exactly
 * two things: whether the acknowledgement is ticked, and the refusal that came
 * back.
 *
 * Everything above it — the two columns, the preview of what moves, the four
 * things that do not, the blockers — is server-rendered by `merge-panel.tsx`
 * from `previewMerge`. A checkbox that gates a button is DOM state and nothing
 * else; it dies on navigation and nobody would want to send it to anyone.
 *
 * R8 keeps the acknowledgement for merge *specifically*, and the panel's
 * preview does not replace it: reading what will move and accepting that it
 * cannot be undone from this screen are two different acts, and only the
 * second one is a decision.
 */

import { useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/field';
import { mergePeopleAction } from './actions';
import styles from './people.module.css';

export interface MergeConfirmProps {
  sourceId: string;
  targetId: string;
  sourceName: string;
  /** Where to go once the merge lands: the target's record page. */
  successHref: string;
}

export function MergeConfirm({
  sourceId, targetId, sourceName, successHref,
}: MergeConfirmProps): ReactElement {
  const router = useRouter();
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function merge() {
    if (!acknowledged) return;
    setError(null);
    setPending(true);
    try {
      const result = await mergePeopleAction(sourceId, targetId);
      if (result.ok) {
        /*
         * The record that survived, never the one that no longer exists.
         * Landing back on the source would show a person every list
         * deliberately hides, with no way to tell why the screen looks empty.
         */
        router.push(successHref);
      } else {
        setError(result.error);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.mergeConfirm}>
      {/* Verbatim from merge-control.tsx, which this replaces. The sentence is
          still true only because `unmergePerson` still has no UI — see the
          note on it in link.ts. */}
      <p className="muted">
        מיזוג מעביר את כל הכינויים של <bdi>{sourceName}</bdi> לאדם אחר, ומסמן
        את הרשומה הזו כמאוחדת בתוכו. זו לא פעולת ניקוי שגרתית — הפעולה אינה
        הפיכה מהמסך הזה, אז לפני שמאשרים כדאי לוודא שמדובר באמת באותו אדם.
      </p>

      <Checkbox
        id="merge-acknowledge"
        label="אני מאשר/ת שמדובר באותו אדם, וזו פעולה בלתי הפיכה מהמסך הזה."
        checked={acknowledged}
        onChange={setAcknowledged}
      />

      <Button
        tone="primary"
        disabled={pending || !acknowledged}
        onClick={() => { void merge(); }}
      >
        מזג
      </Button>

      {error === null ? null : (
        <div className={styles.mergeRefusal} role="alert">{error}</div>
      )}
    </div>
  );
}
