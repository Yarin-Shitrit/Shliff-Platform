'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setExceptionAction } from './actions';
import { formatILS } from '@/lib/money';
import { isBlank } from '@/lib/text/normalize';
import styles from './fees.module.css';

/**
 * Records that one person owes something other than the flat rate.
 *
 * The reason field is mandatory, and this form will not submit without it.
 * A zero due with no recorded reason is exactly what the camp lost last year:
 * `עמירם דהן 0`, and nobody now remembers why.
 */
export function ExceptionForm({
  personId, seasonId, displayName, currentAgorot,
}: {
  personId: string;
  seasonId: string;
  displayName: string;
  currentAgorot: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState(String(currentAgorot / 100));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError('הסכום חייב להיות מספר שאינו שלילי.');
      return;
    }
    // .trim() leaves invisible directional marks standing, which an RTL
    // browser injects on copy-paste — isBlank is the real check.
    if (isBlank(reason)) {
      setError('חריג חייב לכלול סיבה. בלי זה אי אפשר יהיה לדעת בעוד שנה למה.');
      return;
    }

    startTransition(async () => {
      const result = await setExceptionAction({
        personId, seasonId, amount: parsed, reason,
      });
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <form onSubmit={submit} className={styles.exceptionForm}>
      <p className="muted">
        חריג עבור <bdi>{displayName}</bdi> — כרגע{' '}
        <bdi>{formatILS(currentAgorot)} ₪</bdi>
      </p>
      <label>
        סכום
        <input
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label>
        סיבה
        <input
          type="text"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="למשל: פטור מלא — הוביל את ההקמה"
        />
      </label>
      <button type="submit" disabled={pending}>שמור חריג</button>
      {error && <p className="badge-warn" role="alert">{error}</p>}
    </form>
  );
}
