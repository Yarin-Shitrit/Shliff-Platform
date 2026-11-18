'use client';

/**
 * The phone form: what was paid, for what, from which account, and the
 * receipt's photo.
 *
 * Client component because the photo is shrunk in the browser before it is
 * sent (`compress-receipt.ts`) and travels with the fields as one multipart
 * request — a server action would cap it at 1 MB.
 *
 * Nothing is chosen for the person. The account starts empty the first time
 * and must be picked; after that the browser remembers the last one picked
 * here, shown in the select like any other choice and changeable in one tap.
 * After a save the amount, the words, the category and the photo are cleared
 * and the account, the year and the date stay — the next receipt in the pile
 * was usually paid the same way.
 */

import {
  useEffect, useId, useRef, useState, useSyncExternalStore,
} from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, MoneyInput, TextInput } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { isBlank } from '@/lib/text/normalize';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from '@/lib/money/expense-categories';
import { EXPENSE_REFUSALS, RECORD_REFUSALS } from '@/lib/money/expense-refusals';
import { AccountOptions, type AccountChoice } from '../account-options';
import { compressReceipt } from './compress-receipt';
import styles from './expenses.module.css';

const REMEMBERED_ACCOUNT = 'shliff.expenses.account';

/** `localStorage` throws in a private window and when site data is blocked.
 *  Remembering the account is a convenience; the form works without it. */
function recall(): string {
  try { return window.localStorage.getItem(REMEMBERED_ACCOUNT) ?? ''; } catch { return ''; }
}
function remember(accountId: string): void {
  try { window.localStorage.setItem(REMEMBERED_ACCOUNT, accountId); } catch { /* see above */ }
}

/** Nothing else writes the key while the form is open, so nothing to hear. */
function subscribeToNothing(): () => void {
  return () => {};
}

function kilobytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function ExpenseForm({
  seasonId, seasons, accounts, today,
}: {
  seasonId: string;
  seasons: ReadonlyArray<{ id: string; name: string }>;
  accounts: readonly AccountChoice[];
  /** The camp's calendar day, from the server, so the form and the ledger
   *  agree on what "today" is at one in the morning. */
  today: string;
}) {
  const router = useRouter();
  const amountId = useId();
  const descriptionId = useId();
  const accountFieldId = useId();
  const seasonFieldId = useId();
  const dateId = useId();
  const photoId = useId();
  const fileInput = useRef<HTMLInputElement>(null);

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  /** Null until the person picks one here; the remembered one shows meanwhile. */
  const [chosenAccount, setAccountId] = useState<string | null>(null);
  const [season, setSeason] = useState(seasonId);
  const [occurredOn, setOccurredOn] = useState(today);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [shrinking, setShrinking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Read as an external store, so the server render (which has no
  // `localStorage`) and the first client render agree, and the remembered
  // account arrives right after without an effect setting state.
  const remembered = useSyncExternalStore(subscribeToNothing, recall, () => '');
  const accountId = chosenAccount
    ?? (accounts.some((one) => one.id === remembered) ? remembered : '');

  // The preview's object URL holds the picture in memory until it is let go.
  useEffect(() => () => { if (photo !== null) URL.revokeObjectURL(photo.url); }, [photo]);

  async function pick(file: File | undefined) {
    if (file === undefined) return;
    setError(null);
    setSaved(null);
    setShrinking(true);
    try {
      const blob = await compressReceipt(file);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
    } finally {
      setShrinking(false);
    }
  }

  function dropPhoto() {
    setPhoto(null);
    if (fileInput.current !== null) fileInput.current.value = '';
  }

  async function record() {
    setSaved(null);
    // The library's own sentences, said before the round trip. It checks them
    // again: this is the courtesy, that is the rule.
    const typed = Number(amount.replace(/,/g, ''));
    if (amount.trim() === '' || !Number.isFinite(typed) || typed <= 0) {
      setError(EXPENSE_REFUSALS.amount);
      return;
    }
    if (isBlank(description)) { setError(EXPENSE_REFUSALS.description); return; }
    if (accountId === '') { setError(EXPENSE_REFUSALS.pickAccount); return; }
    if (season === '') { setError(EXPENSE_REFUSALS.pickSeason); return; }
    if (occurredOn === '') { setError(EXPENSE_REFUSALS.noDate); return; }

    const body = new FormData();
    body.set('amount', amount);
    body.set('description', description);
    body.set('category', category);
    body.set('accountId', accountId);
    body.set('seasonId', season);
    body.set('occurredOn', occurredOn);
    if (photo !== null) body.set('receipt', photo.blob, 'receipt');

    setError(null);
    setPending(true);
    try {
      let result: { ok: boolean; error?: string };
      try {
        const response = await fetch('/money/expenses/record', { method: 'POST', body });
        result = await response.json() as { ok: boolean; error?: string };
      } catch {
        // No answer at all, or one that is not ours (a proxy's error page).
        // Nothing is cleared: everything typed is still in the form.
        setError(RECORD_REFUSALS.offline);
        return;
      }
      if (!result.ok) {
        setError(typeof result.error === 'string' && result.error !== ''
          ? result.error : RECORD_REFUSALS.offline);
        return;
      }
      remember(accountId);
      setSaved(`נרשם: ${description.trim()} · ${amount.trim()} ₪${photo !== null ? ' · עם קבלה' : ''}`);
      setAmount('');
      setDescription('');
      setCategory('');
      dropPhoto();
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const busy = pending || shrinking;

  return (
    <form
      className={styles.form}
      aria-label="הוצאה חדשה"
      noValidate
      onSubmit={(event) => { event.preventDefault(); void record(); }}
    >
      <Field id={amountId} label="כמה שולם" required>
        <MoneyInput id={amountId} value={amount} disabled={pending} onChange={setAmount} />
      </Field>

      <Field id={descriptionId} label="על מה" required>
        <TextInput
          id={descriptionId} value={description} disabled={pending}
          placeholder="למשל: קרח ומים ליום ההקמה"
          onChange={setDescription}
        />
      </Field>

      <fieldset className={styles.categories} disabled={pending}>
        <legend className={styles.legend}>קטגוריה</legend>
        <div className={styles.chips}>
          {/* A real choice, not a placeholder: an expense nobody filed stays
            * unfiled rather than landing under אחר by default. */}
          {(['', ...EXPENSE_CATEGORIES] as const).map((value) => (
            <label key={value} className={styles.chip}>
              <input
                className={styles.chipInput}
                type="radio" name="expense-category" value={value}
                checked={category === value}
                onChange={() => { setCategory(value); }}
              />
              <span className={styles.chipFace}>
                {value === '' ? 'בלי קטגוריה' : EXPENSE_CATEGORY_LABELS[value]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field id={accountFieldId} label="מאיזה חשבון שולם" required>
        <select
          id={accountFieldId} className={styles.input} value={accountId} disabled={pending}
          onChange={(event) => { setAccountId(event.target.value); }}
        >
          <option value="">בחרו חשבון</option>
          <AccountOptions accounts={accounts} />
        </select>
      </Field>

      <div className={styles.pair}>
        <Field id={dateId} label="תאריך">
          <input
            id={dateId} className={styles.input} type="date" value={occurredOn}
            disabled={pending}
            onChange={(event) => { setOccurredOn(event.target.value); }}
          />
        </Field>
        <Field id={seasonFieldId} label="שנה" hint="נקבעת ביד, לא לפי התאריך">
          <select
            id={seasonFieldId} className={styles.input} value={season} disabled={pending}
            onChange={(event) => { setSeason(event.target.value); }}
          >
            {seasons.map((one) => (
              <option key={one.id} value={one.id}>{one.name}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className={styles.photo}>
        {/* No `capture`: with it Android opens the camera and nothing else,
          * and a receipt that arrived on WhatsApp is already in the gallery.
          * Without it the phone offers both. */}
        <input
          ref={fileInput}
          id={photoId}
          className="sr-only"
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(event) => { void pick(event.target.files?.[0]); }}
        />
        {photo === null ? (
          <label htmlFor={photoId} className={styles.photoButton} aria-disabled={busy}>
            <Icon name="receipt" size={20} />
            {shrinking ? 'מקטין את התמונה…' : 'צילום קבלה'}
          </label>
        ) : (
          <div className={styles.preview}>
            {/* eslint-disable-next-line @next/next/no-img-element -- an object
              * URL of a picture that exists only in this tab; the optimizer
              * cannot fetch it. */}
            <img className={styles.thumb} src={photo.url} alt="הקבלה שצורפה" />
            <div className={styles.previewText}>
              <span>הקבלה צורפה</span>
              <bdi className={styles.previewSize} dir="ltr">{kilobytes(photo.blob.size)}</bdi>
            </div>
            <label htmlFor={photoId} className={styles.previewLink}>החלפה</label>
            <button type="button" className={styles.previewLink} disabled={pending} onClick={dropPhoto}>
              הסרה
            </button>
          </div>
        )}
        <p className={styles.photoHint}>לא חובה. התמונה מוקטנת בטלפון לפני השליחה.</p>
      </div>

      <div className={styles.submit}>
        <Button tone="primary" type="submit" disabled={busy}>
          {pending ? 'רושם…' : 'רישום ההוצאה'}
        </Button>
      </div>

      {error === null ? null : <p className={styles.formError} role="alert">{error}</p>}
      {saved === null ? null : <p className={styles.saved} role="status"><bdi>{saved}</bdi></p>}
    </form>
  );
}
