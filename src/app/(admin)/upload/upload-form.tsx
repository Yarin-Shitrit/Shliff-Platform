'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Hebrew copy for the machine codes `/api/uploads` returns. Anything not
 * listed — including a response that is not JSON at all, such as an HTML error
 * page from an unhandled server fault — falls back to the generic message.
 */
const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'אין לך הרשאה להעלות קבצים.',
  'missing file': 'לא נבחר קובץ.',
  'file too large': 'הקובץ גדול מדי — עד 25 מגה־בייט.',
  'unsupported file type': 'אפשר להעלות רק קובץ אקסל בפורמט xlsx.',
  'import failed': 'לא הצלחנו לקרוא את הקובץ. ודאו שזה קובץ אקסל תקין ונסו שוב.',
};
const FALLBACK_ERROR = 'ההעלאה נכשלה, נסו שוב.';

/**
 * Reads a JSON body without assuming there is one. A 500 answers with an HTML
 * error page and a 413 from a proxy may answer with nothing at all; `.json()`
 * throws on both, and that throw used to escape `onSubmit` and leave `busy`
 * stuck true — the button sat disabled on "מעבד…" with no message, forever.
 */
async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return body !== null && typeof body === 'object' ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function UploadForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/uploads', { method: 'POST', body: form });
      const body = await readJson(response);

      if (!response.ok) {
        const code = typeof body.error === 'string' ? body.error : '';
        setError(ERROR_MESSAGES[code] ?? FALLBACK_ERROR);
        return;
      }
      router.push(`/imports/${body.uploadId}`);
    } catch {
      /* The request never completed — offline, aborted, DNS. */
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card">
      <label htmlFor="file">קובץ אקסל של הקאמפ</label>
      <input id="file" name="file" type="file" accept=".xlsx" required />
      <button type="submit" disabled={busy}>
        {busy ? 'מעבד…' : 'העלה וסרוק'}
      </button>
      {error ? <p className="badge-warn">{error}</p> : null}
    </form>
  );
}
