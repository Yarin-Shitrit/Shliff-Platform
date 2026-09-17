'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { seedAction } from './actions';

export function SeedButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSeed() {
    setBusy(true);
    setError(null);
    try {
      const result = await seedAction();
      setMessage(
        result.imported.length > 0
          ? `נטענו ${result.imported.length} קבצים`
          : 'כל הקבצים כבר במסד',
      );
      router.refresh();
    } catch (error) {
      // Surface the action's own message (e.g. the production refusal)
      // instead of a generic one, so an admin who somehow still sees this
      // button — a stale client bundle from before a deploy, say — gets a
      // real explanation rather than "try again" for something retrying
      // can't fix.
      setError(error instanceof Error ? error.message : 'הטעינה נכשלה, נסו שוב.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <button type="button" onClick={onSeed} disabled={busy}>
        {busy ? 'טוען…' : 'טען את קבצי העבר'}
      </button>
      {message ? <p className="muted">{message}</p> : null}
      {error ? <p className="badge-warn">{error}</p> : null}
    </div>
  );
}
