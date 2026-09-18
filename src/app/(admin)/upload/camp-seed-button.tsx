'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { seedCampAction } from './actions';

/**
 * Seeds the people and money the workbooks name — distinct from the button
 * beside it, which ingests the workbook files. Idempotent: pressing it twice
 * creates nothing the second time, which is what makes it safe as the repair
 * path after a database rebuild.
 */
export function CampSeedButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSeed() {
    setBusy(true);
    setError(null);
    try {
      const result = await seedCampAction();
      const created = result.seasons + result.people + result.events + result.tasks;
      setMessage(
        created > 0
          ? `נוצרו ${result.people} אנשים, ${result.seasons} שנים, `
            + `${result.events} אירועים ו־${result.tasks} משימות`
          : 'הכול כבר קיים במסד',
      );
      router.refresh();
    } catch {
      setError('הזריעה נכשלה, נסו שוב.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <button type="button" onClick={onSeed} disabled={busy}>
        {busy ? 'זורע…' : 'זרע חברי מחנה ודמי קאמפ'}
      </button>
      {message ? <p className="muted">{message}</p> : null}
      {error ? <p className="badge-warn">{error}</p> : null}
    </div>
  );
}
