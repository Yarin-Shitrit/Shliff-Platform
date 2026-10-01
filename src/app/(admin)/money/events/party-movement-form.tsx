'use client';

/**
 * Records one movement of a party's money. A party is usually entered as a
 * run of lines — the door, the bar, the DJ, the sound, the lights — so the
 * drawer stays open after each one, keeps the kind and the account, and
 * clears only the amount and the description.
 *
 * There is no direction control for tickets, bar or a cost: each has one
 * direction and the library refuses the other, so offering the choice would
 * only offer a mistake. The camp a party was shared with is the one case
 * where money moves either way, and there the form asks.
 */

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { isBlank } from '@/lib/text/normalize';
import { formatShekels, toAgorot } from '@/lib/money';
import type { PartyPart } from '@/db/schema/money';
import { recordPartyMovementAction } from './actions';
import styles from './events.module.css';

const NO_ACCOUNT = '';
const ACCOUNT_HINT = 'תנועה בלי חשבון לא נספרת ביתרה של אף קופה';

export function PartyMovementForm({
  eventId, partyName, partnerName, defaultDate, accounts,
}: {
  eventId: string;
  partyName: string;
  partnerName: string | null;
  /** `YYYY-MM-DD` — the party's date, which is when most of its money moved. */
  defaultDate: string;
  accounts: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const dateId = useId();
  const amountId = useId();
  const descriptionId = useId();
  const accountFieldId = useId();

  const [part, setPart] = useState<PartyPart>('tickets');
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [occurredOn, setOccurredOn] = useState(defaultDate);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [accountId, setAccountId] = useState(NO_ACCOUNT);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const kinds: Array<[PartyPart, string]> = [
    ['tickets', 'כרטיסים'],
    ['bar', 'בר'],
    ['cost', 'הוצאה'],
  ];
  if (partnerName !== null) kinds.push(['partner', `התחשבנות עם ${partnerName}`]);

  async function record() {
    if (Number(amount) <= 0 || amount === '' || Number.isNaN(Number(amount))) {
      setError('סכום תנועה חייב להיות חיובי — הכיוון נושא את הסימן');
      return;
    }
    if (part === 'cost' && isBlank(description)) {
      setError('להוצאה חייב להיות תיאור — על מה שילמנו');
      return;
    }
    setError(null);
    setSaved(null);
    setPending(true);
    try {
      const result = await recordPartyMovementAction({
        eventId,
        part,
        direction: part === 'partner' ? direction : undefined,
        amount: Number(amount),
        occurredOn,
        description: isBlank(description) ? undefined : description,
        accountId: accountId === NO_ACCOUNT ? undefined : accountId,
      });
      if (result.ok) {
        setSaved(`נרשם: ${kinds.find(([value]) => value === part)?.[1]} ${formatShekels(toAgorot(amount))}`);
        setAmount('');
        setDescription('');
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
        <legend className={styles.kindsLegend}>מה זה</legend>
        {kinds.map(([value, label]) => (
          <label key={value} className={styles.kind}>
            <input
              type="radio"
              name="party-part"
              value={value}
              checked={part === value}
              disabled={pending}
              onChange={() => { setPart(value); setError(null); }}
            />
            {label}
          </label>
        ))}
      </fieldset>

      {part === 'partner' && partnerName !== null ? (
        <fieldset className={styles.kinds}>
          <legend className={styles.kindsLegend}>לאן הלך הכסף</legend>
          {([['out', `שילמנו ל${partnerName}`], ['in', `${partnerName} שילמו לנו`]] as const)
            .map(([value, label]) => (
              <label key={value} className={styles.kind}>
                <input
                  type="radio"
                  name="party-partner-direction"
                  value={value}
                  checked={direction === value}
                  disabled={pending}
                  onChange={() => { setDirection(value); }}
                />
                {label}
              </label>
            ))}
        </fieldset>
      ) : null}

      <Field id={amountId} label="סכום בשקלים" required>
        <input
          id={amountId} className={styles.input} type="number" min="0" step="0.01"
          inputMode="decimal" value={amount} disabled={pending}
          onChange={(event) => { setAmount(event.target.value); }}
        />
      </Field>

      <Field
        id={descriptionId}
        label={part === 'cost' ? 'על מה' : 'תיאור'}
        required={part === 'cost'}
        hint={part === 'cost' ? undefined : `אם ריק: ״${kinds.find(([value]) => value === part)?.[1]} — ${partyName}״`}
      >
        <input
          id={descriptionId} className={styles.input} type="text" value={description}
          disabled={pending}
          onChange={(event) => { setDescription(event.target.value); }}
        />
      </Field>

      <Field id={dateId} label="תאריך">
        <input
          id={dateId} className={styles.input} type="date" value={occurredOn}
          disabled={pending}
          onChange={(event) => { setOccurredOn(event.target.value); }}
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

      <Button tone="primary" onClick={record} disabled={pending}>רישום</Button>
      {saved === null ? null : <p className={styles.formSaved} role="status">{saved}</p>}
      {error === null ? null : <p className={styles.formError} role="alert">{error}</p>}
    </div>
  );
}
