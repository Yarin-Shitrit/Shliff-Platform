'use client';

/**
 * The two buttons on this screen that call a server action without opening a
 * drawer. Client components because each shows pending state and its own
 * refusal inline; everything else on the row is a link.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatShekels } from '@/lib/money';
import { issueDueForAction, issueDuesAction } from './actions';
import styles from './fees.module.css';

/** One member's flat rate. Never the season's — a button must not do more
 *  than it says (see the comment on `issueDueForAction`). */
export function IssueDueButton({ personId, seasonId, flatRateAgorot }: {
  personId: string; seasonId: string; flatRateAgorot: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setError(null);
    setPending(true);
    try {
      const result = await issueDueForAction(personId, seasonId);
      if (result.ok) router.refresh();
      else setError(result.error);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={issue} disabled={pending}>
        {/* A17: one isolate around the whole phrase, not one around the amount. */}
        <bdi>{`הנפקת חיוב ${formatShekels(flatRateAgorot)}`}</bdi>
      </Button>
      {error && <p className={styles.formError} role="alert">{error}</p>}
    </>
  );
}

/** Everyone on the roster who has no due yet. `issueFlatDues` never touches an
 *  existing due, but the label is what tells a lead that beforehand. */
export function IssueMissingDuesButton({ seasonId, missingCount, flatRateAgorot }: {
  seasonId: string; missingCount: number; flatRateAgorot: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setError(null);
    setPending(true);
    try {
      const result = await issueDuesAction(seasonId);
      if (result.ok) router.refresh();
      else setError(result.error);
    } finally {
      setPending(false);
    }
  }

  if (missingCount === 0) return null;

  return (
    <>
      <Button size="sm" onClick={issue} disabled={pending}>
        <bdi>
          {`הנפקת חיוב ל־${missingCount} — ${formatShekels(missingCount * flatRateAgorot)}`}
        </bdi>
      </Button>
      {error && <p className={styles.formError} role="alert">{error}</p>}
    </>
  );
}
