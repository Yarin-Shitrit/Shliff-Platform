'use client';

/**
 * One form for a new party and for correcting one: the fields are the same,
 * and two copies would drift on what a party is. The season is asked only
 * when creating — a party's money is booked to its season, so moving one
 * between years afterwards would quietly move every shekel with it.
 *
 * No kit date input exists (§5 A28), so the date is a native control inside
 * the kit's `Field`, as in the ledger's own form.
 */

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { isBlank } from '@/lib/text/normalize';
import { createPartyAction, updatePartyAction } from './actions';
import styles from './events.module.css';

const PARTNER_HINT = 'הכסף שעבר בינינו לבינו נרשם במסיבה כהתחשבנות עם השותף';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export type PartyFormProps = {
  closeHref: string;
} & (
  | {
    mode: 'create';
    seasonId: string;
    seasons: Array<{ id: string; name: string }>;
  }
  | {
    mode: 'edit';
    eventId: string;
    name: string;
    /** `YYYY-MM-DD`, or empty for a party nobody dated. */
    heldOn: string;
    partnerName: string | null;
  }
);

export function PartyForm(props: PartyFormProps) {
  const router = useRouter();
  const nameId = useId();
  const dateId = useId();
  const partnerId = useId();
  const seasonFieldId = useId();

  const editing = props.mode === 'edit';
  const [name, setName] = useState(editing ? props.name : '');
  const [heldOn, setHeldOn] = useState(editing ? props.heldOn : today());
  const [shared, setShared] = useState(editing && props.partnerName !== null);
  const [partnerName, setPartnerName] = useState(editing ? props.partnerName ?? '' : '');
  const [season, setSeason] = useState(editing ? '' : props.seasonId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    // The library's own sentences, checked here so the refusal is immediate.
    if (isBlank(name)) { setError('למסיבה חייב להיות שם'); return; }
    if (heldOn === '') { setError('למסיבה חייב להיות תאריך'); return; }
    if (shared && isBlank(partnerName)) { setError('כתבו עם איזה קאמפ עשינו את המסיבה'); return; }
    setError(null);
    setPending(true);
    try {
      const fields = {
        name,
        heldOn,
        partnerName: shared ? partnerName : undefined,
      };
      if (props.mode === 'create') {
        const result = await createPartyAction({ ...fields, seasonId: season });
        if (!result.ok) { setError(result.error); return; }
        // Straight to the new party, where its money is recorded.
        router.replace(`/money/events/${result.value}?act=movement`);
      } else {
        const result = await updatePartyAction(props.eventId, fields);
        if (!result.ok) { setError(result.error); return; }
        router.replace(props.closeHref);
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.form}>
      <Field id={nameId} label="שם המסיבה" required>
        <input
          id={nameId} className={styles.input} type="text" value={name} disabled={pending}
          onChange={(event) => { setName(event.target.value); }}
        />
      </Field>

      <Field id={dateId} label="תאריך" required>
        <input
          id={dateId} className={styles.input} type="date" value={heldOn} disabled={pending}
          onChange={(event) => { setHeldOn(event.target.value); }}
        />
      </Field>

      {props.mode === 'create' ? (
        <Field id={seasonFieldId} label="שנה" hint="הכסף של המסיבה נספר לשנה הזו">
          <select
            id={seasonFieldId} className={styles.input} value={season} disabled={pending}
            onChange={(event) => { setSeason(event.target.value); }}
          >
            {props.seasons.map((one) => (
              <option key={one.id} value={one.id}>{one.name}</option>
            ))}
          </select>
        </Field>
      ) : null}

      <fieldset className={styles.kinds}>
        <legend className={styles.kindsLegend}>עם מי</legend>
        {([[false, 'לבד'], [true, 'עם קאמפ נוסף']] as const).map(([value, label]) => (
          <label key={label} className={styles.kind}>
            <input
              type="radio"
              name="party-shared"
              checked={shared === value}
              disabled={pending}
              onChange={() => { setShared(value); }}
            />
            {label}
          </label>
        ))}
      </fieldset>

      {shared ? (
        <Field id={partnerId} label="הקאמפ השותף" hint={PARTNER_HINT}>
          <input
            id={partnerId} className={styles.input} type="text" value={partnerName}
            disabled={pending}
            onChange={(event) => { setPartnerName(event.target.value); }}
          />
        </Field>
      ) : null}

      <Button tone="primary" onClick={save} disabled={pending}>
        {editing ? 'שמירת המסיבה' : 'יצירת המסיבה'}
      </Button>
      {error === null ? null : <p className={styles.formError} role="alert">{error}</p>}
    </div>
  );
}
