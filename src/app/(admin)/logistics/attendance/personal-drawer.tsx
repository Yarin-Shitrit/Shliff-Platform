'use client';

/**
 * The drawer for a personal mark — a check for one person on one thing
 * they did alone, with no day of everyone's to put it under. Two modes:
 * `person === null` is the bar's verb, with the person still to pick; a
 * person is their row's own drawer, with their marks listed under the form
 * that adds the next one.
 *
 * Every add and every removal writes at once and says so, with the
 * domain's own inverse on the toast (E2): an add is undone by removing the
 * row it made, a removal by adding back what the row said.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field, Select, TextInput, Textarea } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Pill } from '@/components/ui/pill';
import { useToast } from '@/components/ui/toaster';
import { DateText } from '@/components/format';
import { isBlank } from '@/lib/text/normalize';
import { isCivilDay } from '@/lib/logistics/shift-time';
import {
  civilDate, type BoardRow, type PersonalMark, type RosterMember,
} from '@/lib/logistics/attendance';
import { personHref, type RawParams } from '@/lib/logistics/attendance-views';
import { addPersonalMarkAction, removePersonalMarkAction } from './actions';
import { DAY_REQUIRED, PERSON_REQUIRED, TITLE_REQUIRED } from './failure-messages';
import styles from './attendance.module.css';

type Refusal = { where: 'person' | 'day' | 'title' | 'form'; message: string };

const PERSON_ID = 'personal-person';
const DAY_ID = 'personal-day';
const TITLE_ID = 'personal-title';
const NOTES_ID = 'personal-notes';

export function PersonalDrawer({
  person, seasonId, seasonName, closeHref, params, roster, presetDay,
}: {
  /** The row whose drawer this is, or null for the bar's verb. */
  person: BoardRow | null;
  seasonId: string;
  seasonName: string;
  closeHref: string;
  /** The page's URL params, so the drawer can move over the person it just marked. */
  params: RawParams;
  /** Who can be picked, by name. */
  roster: readonly RosterMember[];
  /** A day to start the form on, `YYYY-MM-DD`. Today, usually. */
  presetDay: string;
}) {
  const router = useRouter();
  const { show } = useToast();

  const [personId, setPersonId] = useState(person?.personId ?? '');
  const [day, setDay] = useState(presetDay);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  /* Taken off the list the moment it is removed; the page's refresh brings
     the real list back under it. */
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());

  function errorFor(where: Refusal['where']): string | undefined {
    return refusal?.where === where ? refusal.message : undefined;
  }

  function nameOf(id: string): string {
    return person?.personId === id
      ? person.displayName
      : roster.find((member) => member.personId === id)?.displayName ?? '';
  }

  async function add(formEvent?: FormEvent) {
    formEvent?.preventDefault();
    setRefusal(null);

    // The same refusals the library makes, in the same words, so a lead
    // finds out without a round trip.
    if (personId === '') { setRefusal({ where: 'person', message: PERSON_REQUIRED }); return; }
    if (!isCivilDay(day)) { setRefusal({ where: 'day', message: DAY_REQUIRED }); return; }
    if (isBlank(title)) { setRefusal({ where: 'title', message: TITLE_REQUIRED }); return; }

    const input = { personId, doneOn: day, title: title.trim(), notes: isBlank(notes) ? null : notes };
    const name = nameOf(personId);

    setPending(true);
    try {
      const result = await addPersonalMarkAction(seasonId, input);
      if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }
      const id = result.value;
      show({
        message: `״${input.title}״ נרשם ל${name}`,
        tone: 'ok',
        undo: id === undefined ? undefined : {
          label: 'ביטול',
          run: () => removePersonalMarkAction(id),
        },
      });
      setTitle('');
      setNotes('');
      /* The bar's verb lands on the person's own drawer, where the mark it
         just made is listed and the next one is a title away. A person's
         drawer stays where it is, for the same reason. */
      if (person === null) router.push(personHref(params, personId));
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function remove(mark: PersonalMark) {
    setRemoved((before) => new Set(before).add(mark.id));
    const result = await removePersonalMarkAction(mark.id);
    if (!result.ok) {
      setRemoved((before) => {
        const after = new Set(before);
        after.delete(mark.id);
        return after;
      });
      show({ message: result.error, tone: 'bad' });
      return;
    }
    show({
      message: `״${mark.title}״ של ${mark.displayName} הוסר`,
      tone: 'ok',
      undo: {
        label: 'ביטול',
        run: async () => {
          const added = await addPersonalMarkAction(seasonId, {
            personId: mark.personId, doneOn: mark.doneOn, title: mark.title, notes: mark.notes,
          });
          return added.ok ? { ok: true } : added;
        },
      },
    });
    router.refresh();
  }

  const picking = person === null;
  const canAdd = person === null || person.onRoster;
  const listed = (person?.personal ?? []).filter((mark) => !removed.has(mark.id));

  return (
    <Drawer
      title={picking ? 'סימון אישי' : person.displayName}
      subtitle={picking
        ? `וי על משימה שחבר עשה לבד, ב${seasonName} — לא יום של כולם`
        : (
          <>
            {person.onRoster ? null : <><Pill tone="outline">לא ברשימת השנה</Pill>{' · '}</>}
            <bdi>{`סימונים אישיים ב${seasonName}`}</bdi>
          </>
        )}
      closeHref={closeHref}
      width={500}
      phone="full"
      footer={(
        <span className={styles.footActions}>
          {canAdd ? (
            <Button tone="primary" onClick={() => { void add(); }} disabled={pending}>
              הוספת הסימון
            </Button>
          ) : null}
          <Button onClick={() => { router.push(closeHref); }} disabled={pending}>סגירה</Button>
        </span>
      )}
    >
      {canAdd ? (
        <form className={styles.form} onSubmit={add}>
          {picking ? (
            <Field id={PERSON_ID} label="למי" required error={errorFor('person')}>
              <Select
                id={PERSON_ID}
                value={personId}
                onChange={setPersonId}
                emptyLabel="בחירה…"
                options={roster.map((member) => ({ value: member.personId, label: member.displayName }))}
              />
            </Field>
          ) : null}

          <div className={styles.pair}>
            <Field id={DAY_ID} label="באיזה יום" required error={errorFor('day')}>
              {/* The kit ships no `date` control (see `event-drawer.tsx`). */}
              <input
                className={styles.plainInput}
                id={DAY_ID}
                type="date"
                value={day}
                onChange={(changed) => { setDay(changed.target.value); }}
              />
            </Field>
            <Field
              id={TITLE_ID}
              label="מה נעשה"
              required
              error={errorFor('title')}
              hint="״הביא את הגנרטור״, ״הדפיס מדבקות״ — מה שיזכיר לכולם על מה הווי."
            >
              <TextInput id={TITLE_ID} value={title} onChange={setTitle} />
            </Field>
          </div>

          <Field id={NOTES_ID} label="הערות">
            <Textarea id={NOTES_ID} value={notes} onChange={setNotes} rows={2} />
          </Field>

          {refusal?.where === 'form' && (
            <p className={styles.formError} role="alert">{refusal.message}</p>
          )}
        </form>
      ) : (
        <p className={styles.rosterNote}>
          {`${person.displayName} כבר לא ברשימת ${seasonName}, ולכן אי אפשר להוסיף סימון. מה שנרשם נשאר.`}
        </p>
      )}

      {picking ? null : (
        <section className={styles.roster} aria-labelledby="personal-list-heading">
          <h3 id="personal-list-heading" className={styles.rosterHeading}>
            {listed.length === 0 ? 'עדיין אין סימונים אישיים' : `סימונים אישיים · ${listed.length}`}
          </h3>
          {listed.length === 0 ? null : (
            <ul className={styles.personalList}>
              {listed.map((mark) => (
                <li key={mark.id} className={styles.personalRow}>
                  <span className={styles.personalWords}>
                    <span className={styles.personalTitle}>{mark.title}</span>
                    <span className={styles.personalWhen}>
                      <DateText at={civilDate(mark.doneOn)} form="full" />
                      {mark.notes === null ? null : <>{' · '}<bdi>{mark.notes}</bdi></>}
                    </span>
                  </span>
                  <Button
                    tone="ghost"
                    size="sm"
                    iconLabel={`הסרה · ${mark.title}`}
                    onClick={() => { void remove(mark); }}
                  >
                    <Icon name="x" size={14} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </Drawer>
  );
}
