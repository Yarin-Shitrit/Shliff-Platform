'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { isBlank } from '@/lib/text/normalize';
import { ROLE_LABELS } from '@/lib/members/labels';
import { Field, Select, TextInput } from '@/components/ui/field';
import { Button, ButtonLink } from '@/components/ui/button';
import { addMemberAction, createPersonAction } from './actions';
import styles from './people.module.css';

export interface SeasonOption {
  id: string;
  name: string;
}

const ROLES = Object.keys(ROLE_LABELS);

/**
 * Creates a brand-new person. Name is the only required field — the season is
 * optional, because "joined the camp but not assigned to a season yet" is a
 * real, valid state, not a form left half-filled.
 *
 * Blankness is checked client-side before the action is ever called, and a
 * name that resolves to an existing person is refused server-side — this
 * form only surfaces that refusal, it never decides identity itself.
 *
 * Both refusals land on the name field: the blank one is about the name, and
 * the server's `כבר קיים אדם בשם …` names the spelling that collided, so the
 * field it sits under is the one a lead has to change.
 *
 * The form lives in a drawer the list opens from `?act=new` (R6), so it takes
 * the list's own URL as `doneHref` and goes back there once the person
 * exists — the list re-renders with the new row and the drawer is gone.
 * Without `doneHref` it refreshes in place, which is what a bare form
 * rendered on a page wants.
 */
export function AddMember({
  seasons, defaultSeasonId, doneHref,
}: {
  seasons: SeasonOption[];
  /** The season the list is scoped to — chosen in the box, never silently. */
  defaultSeasonId?: string;
  /** Where to go once the person exists; also the cancel link. */
  doneHref?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [seasonId, setSeasonId] = useState(defaultSeasonId ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (isBlank(name)) {
      setError('שם לא יכול להיות ריק.');
      return;
    }

    setPending(true);
    try {
      const result = await createPersonAction(name, seasonId || undefined);
      if (result.ok) {
        setName('');
        setSeasonId(defaultSeasonId ?? '');
        if (doneHref === undefined) {
          router.refresh();
        } else {
          router.replace(doneHref);
          router.refresh();
        }
      } else {
        setError(result.error);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className={styles.form} noValidate>
      <Field
        id="add-person-name"
        label="שם"
        hint="כפי שהשם מופיע בקבצים, כדי שהייבוא ימצא את האדם."
        error={error ?? undefined}
      >
        <TextInput
          id="add-person-name"
          value={name}
          onChange={setName}
          placeholder="שם מלא"
        />
      </Field>
      <Field
        id="add-person-season"
        label="שיוך לשנה"
        hint="אפשר גם בלי שנה, ולשייך אחר כך מדף האדם."
      >
        <Select
          id="add-person-season"
          value={seasonId}
          onChange={setSeasonId}
          emptyLabel="ללא שנה כרגע"
          options={seasons.map((season) => ({ value: season.id, label: season.name }))}
        />
      </Field>
      <div className={styles.formActions}>
        <Button tone="primary" type="submit" disabled={pending}>הוסף אדם</Button>
        {doneHref === undefined ? null : (
          <ButtonLink tone="ghost" href={doneHref} replace>ביטול</ButtonLink>
        )}
      </div>
    </form>
  );
}

/**
 * Adds an existing person to a season they are not on yet.
 *
 * A person already on every season sees a disabled message rather than a
 * select with nothing usable in it — an empty-but-enabled control invites a
 * click that can only fail.
 */
export function AddToSeason({
  personId, seasons, memberSeasonIds,
}: {
  personId: string;
  seasons: SeasonOption[];
  memberSeasonIds: string[];
}) {
  const router = useRouter();
  const available = seasons.filter((season) => !memberSeasonIds.includes(season.id));
  const [seasonId, setSeasonId] = useState(available[0]?.id ?? '');
  const [role, setRole] = useState(ROLES[0]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Distinguished from "already on every season": with no seasons at all in
  // the system, that message would misleadingly imply there was ever
  // something to join.
  if (seasons.length === 0) {
    return <p className="muted">עדיין אין שנים במערכת.</p>;
  }
  if (available.length === 0) {
    return <p className="muted">משויך/ת כבר לכל השנים הקיימות.</p>;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!seasonId) return;
    setError(null);
    setPending(true);
    try {
      const result = await addMemberAction(personId, seasonId, role);
      if (result.ok) router.refresh();
      else setError(result.error);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className={styles.inlineForm} noValidate>
      <Field id="add-to-season-season" label="שנה">
        <Select
          id="add-to-season-season"
          value={seasonId}
          onChange={setSeasonId}
          options={available.map((season) => ({ value: season.id, label: season.name }))}
        />
      </Field>
      <Field id="add-to-season-role" label="תפקיד">
        <Select
          id="add-to-season-role"
          value={role}
          onChange={setRole}
          options={ROLES.map((value) => ({ value, label: ROLE_LABELS[value] }))}
        />
      </Field>
      <div className={styles.formActions}>
        <Button tone="primary" type="submit" disabled={pending}>שייך לשנה</Button>
      </div>
      {/* Not a field's own refusal: `אין הרשאה` is about the lead, not the
          season or the role, so it sits under the whole form. */}
      {error === null ? null : <p className={styles.formError} role="alert">{error}</p>}
    </form>
  );
}
