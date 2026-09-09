'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function UploadForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/uploads', { method: 'POST', body: form });
    const body = await response.json();

    setBusy(false);
    if (!response.ok) {
      setError(body.error ?? 'שגיאה בהעלאה');
      return;
    }
    router.push(`/imports/${body.uploadId}`);
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
