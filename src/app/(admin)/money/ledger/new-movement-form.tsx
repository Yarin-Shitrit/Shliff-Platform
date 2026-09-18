'use client';

/**
 * Client component because the direction choice and the account choice each
 * change what the rest of the form means, and both of the library's refusals
 * have to fire before a write. A movement with no account is a deliberate,
 * consequential choice — it lands in the unattributed banner — so the form
 * says what it costs at the moment it is made, which a Server Component
 * could only do after a round trip.
 *
 * No kit select, number input or date input exists (§5 A28), so these are
 * native controls inside the kit's `Field`.
 */

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { isBlank } from '@/lib/text/normalize';
import { recordMovementAction } from './actions';
import styles from './ledger.module.css';

/** Not a real account, and not a value the action would accept. */
const NO_ACCOUNT = '';
/** Not a real season. A movement genuinely may belong to no year. */
const NO_SEASON = '';

const ACCOUNT_HINT = 'תנועה בלי חשבון לא נספרת ביתרה של אף קופה, ותופיע בהתראה למעלה';
const SEASON_HINT = 'השנה נקבעת ביד, לא לפי התאריך';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function NewMovementForm({
  seasonId, seasons, accounts, budgetLines, closeHref,
}: {
  seasonId: string | null;
  seasons: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; name: string }>;
  budgetLines: Array<{ id: string; label: string }>;
  closeHref: string;
}) {
  const router = useRouter();
  const dateId = useId();
  const amountId = useId();
  const descriptionId = useId();
  const accountFieldId = useId();
  const seasonFieldId = useId();
  const budgetFieldId = useId();

  const [occurredOn, setOccurredOn] = useState(today());
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [accountId, setAccountId] = useState(NO_ACCOUNT);
  const [season, setSeason] = useState(seasonId ?? NO_SEASON);
  const [budgetLineId, setBudgetLineId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function record() {
    // Both sentences are `recordEntry`'s own. Checked here so the refusal is
    // immediate, and by the library so it is a rule rather than a courtesy —
    // the wording is shared precisely so the two cannot say different things
    // about the same movement.
    if (Number(amount) <= 0 || amount === '') {
      setError('סכום תנועה חייב להיות חיובי — הכיוון נושא את הסימן');
      return;
    }
    if (isBlank(description)) {
      setError('לתנועה חייב להיות תיאור');
      return;
    }
    setError(null);
    setPending(true);
    try {
      const result = await recordMovementAction({
        occurredOn,
        direction,
        amount: Number(amount),
        description,
        accountId: accountId === NO_ACCOUNT ? undefined : accountId,
        seasonId: season === NO_SEASON ? undefined : season,
        budgetLineId: budgetLineId === '' ? undefined : budgetLineId,
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
      {/* Two words, never a sign. A11's rule lives in the model here as well
        * as in the table: there is no field in this form that could carry a
        * minus, so a negative movement cannot be expressed at all. */}
      <fieldset className={styles.kinds}>
        <legend className={styles.kindsLegend}>כיוון</legend>
        {([['in', 'נכנס'], ['out', 'יצא']] as const).map(([value, label]) => (
          <label key={value} className={styles.kind}>
            <input
              type="radio"
              name="movement-direction"
              value={value}
              checked={direction === value}
              disabled={pending}
              onChange={() => { setDirection(value); }}
            />
            {label}
          </label>
        ))}
      </fieldset>

      <Field id={dateId} label="תאריך">
        <input
          id={dateId} className={styles.input} type="date" value={occurredOn}
          disabled={pending}
          onChange={(event) => { setOccurredOn(event.target.value); }}
        />
      </Field>

      <Field id={amountId} label="סכום בשקלים">
        <input
          id={amountId} className={styles.input} type="number" min="0" step="0.01"
          value={amount} disabled={pending}
          onChange={(event) => { setAmount(event.target.value); }}
        />
      </Field>

      <Field id={descriptionId} label="תיאור">
        <input
          id={descriptionId} className={styles.input} type="text" value={description}
          disabled={pending}
          onChange={(event) => { setDescription(event.target.value); }}
        />
      </Field>

      <Field id={accountFieldId} label="חשבון" hint={ACCOUNT_HINT}>
        <select
          id={accountFieldId} className={styles.input} value={accountId} disabled={pending}
          onChange={(event) => { setAccountId(event.target.value); }}
        >
          <option value={NO_ACCOUNT}>לא צוין</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>{account.name}</option>
          ))}
        </select>
      </Field>

      <Field id={seasonFieldId} label="שנה" hint={SEASON_HINT}>
        <select
          id={seasonFieldId} className={styles.input} value={season} disabled={pending}
          onChange={(event) => { setSeason(event.target.value); }}
        >
          <option value={NO_SEASON}>ללא שנה</option>
          {seasons.map((one) => (
            <option key={one.id} value={one.id}>{one.name}</option>
          ))}
        </select>
      </Field>

      <Field id={budgetFieldId} label="סעיף תקציב">
        <select
          id={budgetFieldId} className={styles.input} value={budgetLineId} disabled={pending}
          onChange={(event) => { setBudgetLineId(event.target.value); }}
        >
          <option value="">ללא סעיף</option>
          {budgetLines.map((line) => (
            <option key={line.id} value={line.id}>{line.label}</option>
          ))}
        </select>
      </Field>

      <Button tone="primary" onClick={record} disabled={pending}>רישום התנועה</Button>
      {error === null ? null : <p className={styles.formError} role="alert">{error}</p>}
    </div>
  );
}
