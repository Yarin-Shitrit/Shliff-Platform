'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { seedAction } from './actions';

/**
 * Hebrew copy for the machine codes `seedAction` throws. Same convention as
 * `upload-form.tsx`'s `ERROR_MESSAGES`: all user-facing copy is Hebrew, so a
 * raw thrown string (English, or absent entirely) never reaches the screen —
 * anything unrecognized falls back to the generic message.
 */
const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'אין לך הרשאה לטעון את קבצי העבר.',
  production: 'טעינת קבצי העבר היא כלי פיתוח בלבד ואינה זמינה בסביבת ייצור.',
};
const FALLBACK_ERROR = 'הטעינה נכשלה, נסו שוב.';

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
      const code = error instanceof Error ? error.message : '';
      setError(ERROR_MESSAGES[code] ?? FALLBACK_ERROR);
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
