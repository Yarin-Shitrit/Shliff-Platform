'use client';

/**
 * Who is on one task: the season's roster as a checklist. Every tick writes
 * at once and says so — there is no second "save", because a tick is the
 * whole of the decision — and the toast offers the inverse.
 *
 * The filter only narrows what is drawn; the count in the heading is of
 * everyone on the task, filtered out or not. A person already on another
 * task of the same day is still offered, with the task named beside them:
 * the lead decides whether that is a problem.
 *
 * A client component because a checklist is state. The drawer is still a
 * URL (R6): the page reads `?task=` and hands it the record.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field, TextInput, Checkbox } from '@/components/ui/field';
import { ButtonLink } from '@/components/ui/button';
import { useToast } from '@/components/ui/toaster';
import { setCrewMemberAction } from './actions';
import styles from './workdays.module.css';

export interface CrewOption {
  personId: string;
  displayName: string;
  /** False for someone on the task who has left the season's roster. */
  onRoster: boolean;
  /** The other tasks of this day they are on. */
  alsoOn: string[];
}

const FILTER_ID = 'crew-filter';

export function CrewDrawer({
  task, dayLabel, closeHref, people, onTask,
}: {
  task: { id: string; title: string };
  /** `יום עבודה · יום שבת 14/03/2026`, for the subtitle. */
  dayLabel: string;
  closeHref: string;
  /** The roster by name, then anyone on the task who has left it. */
  people: readonly CrewOption[];
  /** Who is on the task now, by person id. */
  onTask: readonly string[];
}) {
  const router = useRouter();
  const { show } = useToast();
  const [filter, setFilter] = useState('');
  /* Drawn ticked the moment it is ticked; the page's refresh brings the real
     state back under it. */
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set(onTask));
  const [writing, setWriting] = useState<string | null>(null);

  function draw(personId: string, on: boolean) {
    setMarked((before) => {
      const after = new Set(before);
      if (on) after.add(personId); else after.delete(personId);
      return after;
    });
  }

  async function set(person: CrewOption, on: boolean) {
    setWriting(person.personId);
    draw(person.personId, on);
    try {
      const result = await setCrewMemberAction(task.id, person.personId, on);
      if (!result.ok) {
        draw(person.personId, !on);
        show({ message: result.error, tone: 'bad' });
        return;
      }
      show({
        message: on
          ? `${person.displayName} · נוסף שיבוץ ל${task.title}`
          : `${person.displayName} · הוסר השיבוץ ל${task.title}`,
        tone: 'ok',
        /* E2: the undo is the same write, the other way. */
        undo: {
          label: 'ביטול',
          run: async () => {
            const undone = await setCrewMemberAction(task.id, person.personId, !on);
            if (undone.ok) { draw(person.personId, !on); router.refresh(); }
            return undone;
          },
        },
      });
      router.refresh();
    } finally {
      setWriting(null);
    }
  }

  const wanted = filter.trim();
  const shown = wanted === '' ? people : people.filter((person) => person.displayName.includes(wanted));

  return (
    <Drawer
      title={task.title}
      subtitle={dayLabel}
      closeHref={closeHref}
      phone="full"
      footer={<ButtonLink tone="primary" href={closeHref}>סיום</ButtonLink>}
    >
      <section className={styles.crewForm} aria-labelledby="crew-heading">
        <h3 id="crew-heading" className={styles.crewHeading}>
          {marked.size === 0 ? 'עדיין לא שובץ אף אחד' : `משובצים · ${marked.size}`}
        </h3>
        {people.length === 0 ? (
          <p className={styles.note}>
            אין עדיין חברים ברשימת השנה. מוסיפים אותם במסך אנשים, והם יופיעו כאן.
          </p>
        ) : (
          <>
            <Field id={FILTER_ID} label="חיפוש לפי שם">
              <TextInput id={FILTER_ID} value={filter} onChange={setFilter} />
            </Field>
            {shown.length === 0 ? (
              <p className={styles.note}>אין ברשימה שם שמכיל את מה שנכתב.</p>
            ) : (
              <ul className={styles.crewList}>
                {shown.map((person) => (
                  <li key={person.personId} className={styles.crewRow}>
                    <Checkbox
                      id={`crew-${person.personId}`}
                      label={person.displayName}
                      checked={marked.has(person.personId)}
                      /* Someone off the roster can be taken off the task, not put back on it. */
                      disabled={writing === person.personId || (!person.onRoster && !marked.has(person.personId))}
                      onChange={(next) => { void set(person, next); }}
                    />
                    {person.onRoster ? null : <span className={styles.rowNote}>לא ברשימת השנה</span>}
                    {person.alsoOn.length === 0 ? null : (
                      <span className={styles.rowNote}><bdi>{`גם ב: ${person.alsoOn.join(', ')}`}</bdi></span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </Drawer>
  );
}
