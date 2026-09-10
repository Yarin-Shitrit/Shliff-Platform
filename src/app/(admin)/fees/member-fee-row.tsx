'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ActionResult } from '@/lib/action-result';
import { formatILS } from '@/lib/money';
import { isBlank } from '@/lib/text/normalize';
import { PAYMENT_CHANNELS } from '@/db/schema/camp';
import type { PaymentChannel } from '@/db/schema/camp';
import type { MemberFeeRow as MemberFeeRowData } from '@/lib/fees/season-fees';
import {
  issueDuesAction, issueDueForAction, clearExceptionAction, recordPaymentAction,
  deletePaymentAction,
} from './actions';
import { ExceptionForm } from './exception-form';
import styles from './fees.module.css';

/** Today, as a `<input type="date">` value, in the viewer's local time zone. */
function todayInputValue(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('he-IL');
}

/**
 * The page-level counterpart to the per-row issue control: fills the flat
 * rate in for every roster member who does not have a due yet. Labelled with
 * the count so it reads as "everyone missing one", not "re-charge the season"
 * — `issueFlatDues` is idempotent and never touches an existing due either
 * way, but the label is what tells a lead that before they click it.
 */
export function IssueMissingDuesButton({
  seasonId, missingCount,
}: {
  seasonId: string;
  missingCount: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (missingCount === 0) return null;

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

  return (
    <div className={styles.issueAll}>
      <button type="button" onClick={issue} disabled={pending}>
        הנפק חיוב לכל מי שעדיין אין לו חיוב (<bdi>{missingCount}</bdi>)
      </button>
      {error && <p className="badge-warn" role="alert">{error}</p>}
    </div>
  );
}

/**
 * One table row for one roster member, with every field a lead can change:
 * issuing the flat rate when there is no due yet, editing the amount (with a
 * mandatory reason, since a changed amount is an exception), clearing an
 * exception, recording a payment and removing one.
 */
export function MemberFeeRow({
  row, seasonId,
}: {
  row: MemberFeeRowData;
  seasonId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState<PaymentChannel>(PAYMENT_CHANNELS[0]);
  const [paidOn, setPaidOn] = useState(todayInputValue());
  const [note, setNote] = useState('');

  async function run(action: () => Promise<ActionResult>) {
    setError(null);
    setPending(true);
    try {
      const result = await action();
      if (result.ok) router.refresh();
      else setError(result.error);
      return result;
    } finally {
      setPending(false);
    }
  }

  function issue() {
    // Per-person, not season-wide. The button sits on one member's row and
    // says "issue a due at the flat rate"; wiring it to issueDuesAction made
    // it fill in every member missing one, which is a larger action than the
    // label promises and not one a lead would notice until afterwards.
    run(() => issueDueForAction(row.personId, seasonId));
  }

  function clear() {
    run(() => clearExceptionAction(row.personId, seasonId));
  }

  function removePayment(paymentId: string) {
    run(() => deletePaymentAction(paymentId));
  }

  async function submitPayment(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('סכום התשלום חייב להיות מספר חיובי.');
      return;
    }
    if (channel === 'קיזוז' && isBlank(note)) {
      setError('קיזוז חייב לכלול הערה שמסבירה מול מה הוא קוזז — אחרת אי אפשר לדעת בעתיד.');
      return;
    }

    const result = await run(() => recordPaymentAction({
      dueId: row.dueId!,
      amount: parsed,
      channel,
      paidOn,
      note: isBlank(note) ? undefined : note,
    }));
    if (result.ok) {
      setAmount('');
      setNote('');
    }
  }

  if (row.dueId === null) {
    return (
      <tr>
        <td>
          <Link href={`/members/${row.personId}`}>{row.displayName}</Link>
        </td>
        <td colSpan={4} className="muted">עדיין אין חיוב.</td>
        <td>
          <button type="button" onClick={issue} disabled={pending}>
            הנפק חיוב לפי התעריף הרגיל
          </button>
          {error && <p className="badge-warn" role="alert">{error}</p>}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <Link href={`/members/${row.personId}`}>{row.displayName}</Link>
      </td>
      <td><bdi>{formatILS(row.amountAgorot!)} ₪</bdi></td>
      <td><bdi>{formatILS(row.paidAgorot)} ₪</bdi></td>
      <td className={row.settled ? undefined : 'badge-warn'}>
        <bdi>{formatILS(row.outstandingAgorot)} ₪</bdi>
      </td>
      <td>
        {row.kind === 'exception'
          ? <span title={row.exceptionReason ?? ''}>חריג</span>
          : <span className="muted">רגיל</span>}
      </td>
      <td>
        <div className={styles.rowControls}>
          <ExceptionForm
            personId={row.personId}
            seasonId={seasonId}
            displayName={row.displayName}
            currentAgorot={row.amountAgorot!}
          />

          {row.kind === 'exception' && (
            <button type="button" onClick={clear} disabled={pending}>
              בטל חריג וחזור לתעריף הרגיל
            </button>
          )}

          <form onSubmit={submitPayment} className={styles.paymentForm}>
            <p className="muted">רישום תשלום</p>
            <label>
              סכום התשלום
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <label>
              אמצעי תשלום
              <select
                value={channel}
                onChange={(event) => setChannel(event.target.value as PaymentChannel)}
              >
                {PAYMENT_CHANNELS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label>
              תאריך תשלום
              <input
                type="date"
                value={paidOn}
                onChange={(event) => setPaidOn(event.target.value)}
              />
            </label>
            <label>
              הערת תשלום
              <input
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={channel === 'קיזוז' ? 'מול מה קוזז (חובה)' : 'לא חובה'}
              />
            </label>
            <button type="submit" disabled={pending}>רשום תשלום</button>
          </form>

          {row.payments.length > 0 && (
            <ul className={styles.paymentsList}>
              {row.payments.map((payment) => (
                <li key={payment.id}>
                  <bdi>{formatILS(payment.amountAgorot)} ₪</bdi>
                  {' · '}
                  {payment.channel}
                  {' · '}
                  <bdi>{formatDate(payment.paidOn)}</bdi>
                  {payment.note && <>{' · '}{payment.note}</>}
                  <button
                    type="button"
                    onClick={() => removePayment(payment.id)}
                    disabled={pending}
                  >
                    הסר
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && <p className="badge-warn" role="alert">{error}</p>}
        </div>
      </td>
    </tr>
  );
}
