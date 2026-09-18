'use client';

/**
 * Client component because the choice between מזומן and קיזוז changes which
 * fields are required and which sentence is true, and both have to happen
 * before submit. The statement that an offset moves no cash — that it enters
 * no קופה and appears in no movement — has to be readable *while* the lead is
 * choosing, not reported back afterwards: it is the difference between the
 * two options, and a lead who reads it after committing has been told
 * something they can no longer act on.
 *
 * No kit select, number input or date input exists (§5 A28), so these are
 * native controls inside the kit's `Field`.
 */

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { fromAgorot } from '@/lib/money';
import { isBlank } from '@/lib/text/normalize';
import type { ObligationDirection } from '@/db/schema/money';
import { settleObligationAction } from './actions';
import styles from './debts.module.css';

type SettleKind = 'cash' | 'offset';

/** Verbatim from the artboard, and the reason this component is a client one. */
const OFFSET_STATEMENT = 'קיזוז אינו מזיז מזומן, ולכן אינו נכנס לאף חשבון ואינו מופיע בתנועות.';

/** `settleObligation`'s own ceiling, stated where the amount is typed rather
 *  than only after the write is refused. */
const AMOUNT_HINT = 'אי אפשר לקזז יותר ממה שחייבים';

const NOTE_HINT = 'חובה — בלי זה אי אפשר לדעת בעוד שנה מה קרה כאן';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SettleForm({
  obligationId, direction, displayParty, outstandingAgorot, accounts, closeHref,
}: {
  obligationId: string;
  direction: ObligationDirection;
  displayParty: string;
  outstandingAgorot: number;
  accounts: Array<{ id: string; name: string }>;
  closeHref: string;
}) {
  const router = useRouter();
  const amountId = useId();
  const accountId2 = useId();
  const noteId = useId();
  const dateId = useId();

  const [kind, setKind] = useState<SettleKind>('cash');
  // `fromAgorot`, not `outstandingAgorot / 100`: money.ts is the only
  // converter, and a float division at a call site is exactly what it exists
  // to prevent.
  const [amount, setAmount] = useState(fromAgorot(outstandingAgorot));
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [settledOn, setSettledOn] = useState(today());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function settle() {
    // `isBlank`, never `.trim()`. A note of a single RLM survives `.trim()`
    // and would be written as a real note explaining nothing — the library
    // refuses it, and the form must refuse it in the same terms rather than
    // sending it and reporting a different-sounding failure.
    if (kind === 'offset' && isBlank(note)) {
      setError('קיזוז חייב לשאת הערה שאומרת מול מה קוזז');
      return;
    }
    if (kind === 'cash' && accountId === '') {
      setError('סגירה במזומן חייבת לציין מאיזה חשבון יצא הכסף');
      return;
    }
    setError(null);
    setPending(true);
    try {
      const result = await settleObligationAction({
        obligationId,
        amount: Number(amount),
        kind,
        accountId: kind === 'cash' ? accountId : undefined,
        note: kind === 'offset' ? note : undefined,
        settledOn,
      });
      if (result.ok) {
        router.replace(closeHref);
        router.refresh();
      } else {
        setError(result.error);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.form}>
      <fieldset className={styles.kinds}>
        <legend className={styles.kindsLegend}>איך נסגר</legend>
        {([['cash', 'מזומן'], ['offset', 'קיזוז מול דמי קאמפ']] as const).map(([value, label]) => (
          <label key={value} className={styles.kind}>
            <input
              type="radio"
              name="settle-kind"
              value={value}
              checked={kind === value}
              disabled={pending}
              onChange={() => { setKind(value); setError(null); }}
            />
            {label}
          </label>
        ))}
      </fieldset>

      {/* Beside the choice, not after it. */}
      {kind === 'offset' ? (
        <p className={styles.offsetStatement}>{OFFSET_STATEMENT}</p>
      ) : null}

      <Field id={amountId} label="סכום בשקלים" hint={AMOUNT_HINT}>
        <input
          id={amountId}
          className={styles.input}
          type="number"
          min="0"
          step="0.01"
          value={amount}
          disabled={pending}
          onChange={(event) => { setAmount(event.target.value); }}
        />
      </Field>

      {kind === 'cash' ? (
        <Field id={accountId2} label="מאיזה חשבון יצא הכסף">
          <select
            id={accountId2}
            className={styles.input}
            value={accountId}
            disabled={pending}
            onChange={(event) => { setAccountId(event.target.value); }}
          >
            <option value="">בחרו חשבון</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
        </Field>
      ) : (
        <Field id={noteId} label="מול מה קוזז" hint={NOTE_HINT}>
          <input
            id={noteId}
            className={styles.input}
            type="text"
            value={note}
            disabled={pending}
            onChange={(event) => { setNote(event.target.value); }}
          />
        </Field>
      )}

      <Field id={dateId} label="תאריך הסגירה">
        <input
          id={dateId}
          className={styles.input}
          type="date"
          value={settledOn}
          disabled={pending}
          onChange={(event) => { setSettledOn(event.target.value); }}
        />
      </Field>

      <p className={styles.formParty}>
        {direction === 'camp_owes' ? 'הקאמפ משלם ל' : 'מתקבל מ'}
        <bdi>{displayParty}</bdi>
      </p>

      <Button tone="primary" onClick={settle} disabled={pending}>סגירת החוב</Button>
      {error === null ? null : <p className={styles.formError} role="alert">{error}</p>}
    </div>
  );
}
