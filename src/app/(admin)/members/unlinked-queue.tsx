'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { linkNameAction, promoteNameAction } from './actions';
import styles from './members.module.css';

export interface QueuedName {
  aliasId: string;
  alias: string;
  candidates: Array<{ personId: string; displayName: string; exact: boolean }>;
}

/**
 * The leads' queue of names import could not attribute.
 *
 * Every row is a decision, never a fait accompli: candidates are offered as
 * buttons a lead presses. Nothing here links anything on its own.
 */
export function UnlinkedQueue({ names }: { names: QueuedName[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) router.refresh();
      else setError(result.error ?? 'שגיאה');
    });
  }

  if (names.length === 0) {
    return <p className="muted">אין שמות שממתינים לשיוך.</p>;
  }

  return (
    <div>
      {error && <p className="badge-warn" role="alert">{error}</p>}
      <ul className={styles.queue}>
        {names.map((name) => (
          <li key={name.aliasId} className={styles.queueRow}>
            <span className={styles.queueName}>{name.alias}</span>
            <span className={styles.queueActions}>
              {name.candidates.map((candidate) => (
                <button
                  key={candidate.personId}
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => linkNameAction(name.aliasId, candidate.personId))}
                >
                  קשר ל<bdi>{candidate.displayName}</bdi>
                  {!candidate.exact && <span className="muted"> (התאמה חלקית)</span>}
                </button>
              ))}
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => promoteNameAction(name.aliasId))}
              >
                צור אדם חדש
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
