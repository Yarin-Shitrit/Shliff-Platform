'use client';

/**
 * A client component because a drop target needs `onDragOver`/`onDrop`, and
 * the upload is a fetch with three visible states. Nothing here holds data a
 * refresh should preserve: the moment the upload succeeds the answer becomes
 * a URL (R6).
 */
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import {
  MAX_UPLOAD_BYTES, UPLOAD_EXTENSION, UPLOAD_RULES_HE, TOO_LARGE_HE, WRONG_TYPE_HE,
} from '@/lib/import/upload-limits';
import styles from './upload.module.css';

/**
 * Hebrew copy for the machine codes `/api/uploads` returns. Anything not
 * listed — including a response that is not JSON at all, such as an HTML
 * error page from an unhandled server fault — falls back to the generic
 * message.
 *
 * The size and type lines are the shared constants, so the refusal a lead
 * reads and the limit the route enforces cannot drift apart.
 */
const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'אין לך הרשאה להעלות קבצים.',
  'missing file': 'לא נבחר קובץ.',
  'file too large': TOO_LARGE_HE,
  'unsupported file type': WRONG_TYPE_HE,
  'import failed': 'לא הצלחנו לקרוא את הקובץ. ודאו שזה קובץ אקסל תקין ונסו שוב.',
};
const FALLBACK_ERROR = 'ההעלאה נכשלה, נסו שוב.';

/**
 * Reads a JSON body without assuming there is one. A 500 answers with an HTML
 * error page and a 413 from a proxy may answer with nothing at all; `.json()`
 * throws on both, and that throw used to escape the submit handler and leave
 * the button disabled on "מעבד…" with no message, forever.
 */
async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return body !== null && typeof body === 'object'
      ? body as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/**
 * The same two rules the route enforces, checked here only so an oversized
 * file does not travel the wire to be refused. The server check remains the
 * enforcement — `accept=".xlsx"` is a hint to the file picker and nothing
 * more, and this function is no stronger.
 */
function localRefusal(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(UPLOAD_EXTENSION)) return WRONG_TYPE_HE;
  if (file.size > MAX_UPLOAD_BYTES) return TOO_LARGE_HE;
  return null;
}

export function UploadDrop() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(file: File) {
    setError(null);
    const refusal = localRefusal(file);
    if (refusal) {
      setError(refusal);
      return;
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch('/api/uploads', { method: 'POST', body: form });
      const body = await readJson(response);

      if (!response.ok) {
        const code = typeof body.error === 'string' ? body.error : '';
        setError(ERROR_MESSAGES[code] ?? FALLBACK_ERROR);
        return;
      }
      /**
       * The route has always answered `200 { duplicate: true }` for a
       * byte-identical file that parsed before, and the old form dropped the
       * flag and pushed as though the upload were new — so a lead
       * re-uploading what they believed was a corrected file landed on a
       * month-old review with no explanation. Carried into the URL so the
       * review can say so (R6: a refresh must not lose it).
       */
      const suffix = body.duplicate === true ? '?duplicate=1' : '';
      router.push(`/imports/${String(body.uploadId)}${suffix}`);
    } catch {
      /* The request never completed — offline, aborted, DNS. */
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.dropWrap}>
      <button
        type="button"
        className={`${styles.drop} ${dragging ? styles.dropOver : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          // Without this the browser leaves the app and renders the workbook.
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void send(file);
        }}
        disabled={busy}
      >
        <Icon name="upload" size={20} />
        <span className={styles.dropLead}>
          {busy ? 'מעבד…' : 'גררו לכאן קובץ, או לחצו לבחירה'}
        </span>
        <span className={styles.dropRules}>{UPLOAD_RULES_HE}</span>
      </button>

      <input
        ref={input}
        className={styles.hiddenInput}
        id="file"
        name="file"
        type="file"
        accept={UPLOAD_EXTENSION}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void send(file);
          event.target.value = '';
        }}
      />

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  );
}
