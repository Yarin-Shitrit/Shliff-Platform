'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { mergePeopleAction } from './actions';
import styles from './members.module.css';

export interface MergeCandidate {
  personId: string;
  displayName: string;
}

/**
 * Folds this person into another, chosen from everyone else in the system.
 *
 * Merge is destructive-adjacent: it is not offered as a routine action. A
 * checkbox confirmation must be ticked before the button does anything, and
 * a conflict refusal — `mergePersons` blocking on an existing membership, due,
 * assignment, prior merge or clashing alias — is rendered prominently, as the
 * normal case rather than an error, because it tells the lead exactly what to
 * unpick first.
 */
export function MergeControl({
  personId, displayName, candidates,
}: {
  personId: string;
  displayName: string;
  candidates: MergeCandidate[];
}) {
  const router = useRouter();
  const [targetId, setTargetId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (candidates.length === 0) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!targetId || !confirmed) return;
    setError(null);
    setPending(true);
    try {
      const result = await mergePeopleAction(personId, targetId);
      if (result.ok) {
        router.refresh();
        setConfirmed(false);
      } else {
        setError(result.error);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className={styles.mergeControl}>
      <p className="muted">
        מיזוג מעביר את כל הכינויים של <bdi>{displayName}</bdi> לאדם אחר, ומסמן
        את הרשומה הזו כמאוחדת בתוכו. זו לא פעולת ניקוי שגרתית — הפעולה אינה
        הפיכה מהמסך הזה, אז לפני שמאשרים כדאי לוודא שמדובר באמת באותו אדם.
      </p>

      <label className={styles.mergeField}>
        מזג לתוך
        <select
          value={targetId}
          onChange={(event) => { setTargetId(event.target.value); setError(null); }}
        >
          <option value="">—</option>
          {candidates.map((candidate) => (
            <option key={candidate.personId} value={candidate.personId}>
              {candidate.displayName}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.mergeConfirm}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        אני מאשר/ת שמדובר באותו אדם, וזו פעולה בלתי הפיכה מהמסך הזה.
      </label>

      <button type="submit" disabled={pending || !targetId || !confirmed}>
        מזג
      </button>

      {error && (
        <div className={styles.mergeRefusal} role="alert">
          {error}
        </div>
      )}
    </form>
  );
}
