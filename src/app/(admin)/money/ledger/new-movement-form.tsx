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
import { campDayKey } from '@/lib/money/counted';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { isBlank } from '@/lib/text/normalize';
import { recordMovementAction, updateMovementAction } from './actions';
import { AccountOptions } from '../account-options';
import type { AccountChoice } from '../account-options';
import styles from './ledger.module.css';

/** Not a real account, and not a value the action would accept. */
const NO_ACCOUNT = '';
/** Not a real season. A movement genuinely may belong to no year. */
const NO_SEASON = '';

const ACCOUNT_HINT = 'תנועה בלי חשבון לא נספרת ביתרה של אף קופה, ותופיע בהתראה למעלה';
const SEASON_HINT = 'השנה נקבעת ביד, לא לפי התאריך';
/** Edit only: the lines on offer are the ones of the year the movement was
 *  opened with, so a changed year has no lines to choose from yet. */
const BUDGET_AFTER_SEASON_HINT = 'סעיפי התקציב שייכים לשנה. שמרו את השנה החדשה, ואז בחרו סעיף.';

/** The movement being corrected, as the inputs hold it. Absent when the form
 *  records a new one. */
export interface EditingMovement {
  id: string;
  /** `YYYY-MM-DD`, the camp day. */
  occurredOn: string;
  direction: 'in' | 'out';
  /** In shekels, as a number input's value. */
  amount: string;
  description: string;
  accountId: string | null;
  seasonId: string | null;
  budgetLineId: string | null;
}

/**
 * Today as the date input wants it — the day it is in the camp, not in UTC.
 * Between midnight and 02:00 (03:00 in summer) Israel time the UTC day is
 * still yesterday, and a movement dated yesterday lands inside a count made
 * yesterday (`insideCount`) and does not move the balance.
 */
function today(): string {
  return campDayKey(new Date());
}

export function NewMovementForm({
  seasonId, seasons, accounts, budgetLines, closeHref, editing,
}: {
  seasonId: string | null;
  seasons: Array<{ id: string; name: string }>;
  accounts: AccountChoice[];
  budgetLines: Array<{ id: string; label: string }>;
  closeHref: string;
  /** Set to correct an existing movement instead of recording a new one.
   *  `budgetLines` are then the lines of *its* year, not the page's. */
  editing?: EditingMovement;
}) {
  const router = useRouter();
  const dateId = useId();
  const amountId = useId();
  const descriptionId = useId();
  const accountFieldId = useId();
  const seasonFieldId = useId();
  const budgetFieldId = useId();

  const [occurredOn, setOccurredOn] = useState(editing?.occurredOn ?? today());
  const [direction, setDirection] = useState<'in' | 'out'>(editing?.direction ?? 'out');
  const [amount, setAmount] = useState(editing?.amount ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [accountId, setAccountId] = useState(editing?.accountId ?? NO_ACCOUNT);
  const [season, setSeason] = useState(
    editing !== undefined ? editing.seasonId ?? NO_SEASON : seasonId ?? NO_SEASON,
  );
  const [budgetLineId, setBudgetLineId] = useState(editing?.budgetLineId ?? '');
  // The lines in hand are the opened year's. Under another year they are not
  // choices, and the library would refuse one anyway.
  const seasonMoved = editing !== undefined && season !== (editing.seasonId ?? NO_SEASON);
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
      const movement = {
        occurredOn,
        direction,
        amount: Number(amount),
        description,
        accountId: accountId === NO_ACCOUNT ? undefined : accountId,
        seasonId: season === NO_SEASON ? undefined : season,
        budgetLineId: budgetLineId === '' || seasonMoved ? undefined : budgetLineId,
      };
      const result = editing === undefined
        ? await recordMovementAction(movement)
        : await updateMovementAction(editing.id, movement);
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
          <AccountOptions accounts={accounts} />
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

      <Field
        id={budgetFieldId} label="סעיף תקציב"
        hint={seasonMoved ? BUDGET_AFTER_SEASON_HINT : undefined}
      >
        <select
          id={budgetFieldId} className={styles.input}
          value={seasonMoved ? '' : budgetLineId} disabled={pending || seasonMoved}
          onChange={(event) => { setBudgetLineId(event.target.value); }}
        >
          <option value="">ללא סעיף</option>
          {budgetLines.map((line) => (
            <option key={line.id} value={line.id}>{line.label}</option>
          ))}
        </select>
      </Field>

      <Button tone="primary" onClick={record} disabled={pending}>
        {editing === undefined ? 'רישום התנועה' : 'שמירת השינויים'}
      </Button>
      {error === null ? null : <p className={styles.formError} role="alert">{error}</p>}
    </div>
  );
}
