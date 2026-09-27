'use client';

/**
 * The form that gives a nameless debt its party.
 *
 * A nameless debt can be neither settled nor dismissed (D8), and until now the
 * inbox's `רישום למי החוב` action led to a drawer that only repeated the
 * refusal. This is the missing half: a lead who has found out who fronted
 * `שולם 500 — מקפיא באיחסון נוסף` writes it here, and the row becomes a debt
 * like any other, with a `סגירה` control.
 *
 * Client component because the choice between a roster person and a bare
 * name changes which control is shown and which sentence is required, and
 * both have to happen before submit. Native controls inside the kit's
 * `Field`, as `SettleForm` does, since the kit has no select for a person.
 */

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { isBlank } from '@/lib/text/normalize';
import { nameObligationAction } from './actions';
import styles from './debts.module.css';

type PartyKind = 'person' | 'name';

/** The label the inbox action carries, so the two say the same thing. Also
 *  spelled in `page.tsx`, which cannot import a string across the client
 *  boundary. */
const NAME_ACTION_LABEL = 'רישום למי החוב';

const PERSON_HINT = 'החוב יופיע בדף האדם, ואפשר יהיה לסגור אותו מכאן';
const NAME_HINT = 'למי שאינו ברשימת האנשים — ספק, או מי שעוד לא נרשם';

/** The form's own refusals, before the library's are asked for. */
const NO_PERSON = 'צריך לבחור אדם מהרשימה';
const NO_NAME = 'צריך לרשום שם';

export function NameForm({
  obligationId, people, closeHref,
}: {
  obligationId: string;
  people: Array<{ id: string; displayName: string }>;
  closeHref: string;
}) {
  const router = useRouter();
  const personFieldId = useId();
  const nameFieldId = useId();

  // A roster with nobody on it leaves only the bare-name path, and says so
  // instead of offering an empty select.
  const rosterEmpty = people.length === 0;
  const [kind, setKind] = useState<PartyKind>(rosterEmpty ? 'name' : 'person');
  const [personId, setPersonId] = useState('');
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function record() {
    if (kind === 'person' && personId === '') {
      setError(NO_PERSON);
      return;
    }
    // `isBlank`, never `.trim()`: a name of one directional mark is not a
    // name, and the library refuses it in the same terms.
    if (kind === 'name' && isBlank(name)) {
      setError(NO_NAME);
      return;
    }
    setError(null);
    setPending(true);
    try {
      const result = await nameObligationAction({
        obligationId,
        personId: kind === 'person' ? personId : undefined,
        partyName: kind === 'name' ? name : undefined,
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
        <legend className={styles.kindsLegend}>למי החוב</legend>
        {([['person', 'אדם מהרשימה'], ['name', 'שם שאינו ברשימה']] as const).map(([value, label]) => (
          <label key={value} className={styles.kind}>
            <input
              type="radio"
              name="party-kind"
              value={value}
              checked={kind === value}
              disabled={pending || (value === 'person' && rosterEmpty)}
              onChange={() => { setKind(value); setError(null); }}
            />
            {label}
          </label>
        ))}
      </fieldset>

      {rosterEmpty ? (
        <p className={styles.refusal}>עדיין אין אנשים ברשימה, אז אפשר לרשום רק שם.</p>
      ) : null}

      {kind === 'person' ? (
        <Field id={personFieldId} label="מי" hint={PERSON_HINT}>
          <select
            id={personFieldId}
            className={styles.input}
            value={personId}
            disabled={pending}
            onChange={(event) => { setPersonId(event.target.value); }}
          >
            <option value="">בחרו אדם</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>{person.displayName}</option>
            ))}
          </select>
        </Field>
      ) : (
        <Field id={nameFieldId} label="שם" hint={NAME_HINT}>
          <input
            id={nameFieldId}
            className={styles.input}
            type="text"
            value={name}
            disabled={pending}
            onChange={(event) => { setName(event.target.value); }}
          />
        </Field>
      )}

      <Button tone="primary" onClick={record} disabled={pending}>{NAME_ACTION_LABEL}</Button>
      {error === null ? null : <p className={styles.formError} role="alert">{error}</p>}
    </div>
  );
}
