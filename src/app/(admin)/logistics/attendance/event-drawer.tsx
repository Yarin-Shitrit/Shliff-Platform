'use client';

/**
 * The drawer over one occasion, in both of its modes: `event === null`
 * adds a day, and a day edits it and lists who was there. One component for
 * one set of fields and one set of refusals.
 *
 * The list under the form is the phone's way of ticking names: the board
 * is too wide for a phone, so a lead standing at the end of a work day
 * opens the day and goes down the roster. On a laptop it is the same list,
 * and useful for the same reason when a day had thirty people at it.
 * Every tick writes at once — there is no second "save" for the marks,
 * because a tick is the whole of the decision.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field, Select, TextInput, Textarea, Checkbox } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Pill } from '@/components/ui/pill';
import { useToast } from '@/components/ui/toaster';
import { DateText } from '@/components/format';
import { isBlank } from '@/lib/text/normalize';
import { isCivilDay } from '@/lib/logistics/shift-time';
import {
  ATTENDANCE_KINDS, civilDate, eventLabel, weekdayOf,
  type AttendanceEvent, type RosterMember,
} from '@/lib/logistics/attendance';
import { ATTENDANCE_KIND_LABELS } from '@/lib/logistics/labels';
import type { AttendanceKind } from '@/db/schema/logistics';
import { eventHref, type RawParams } from '@/lib/logistics/attendance-views';
import {
  createEventAction, updateEventAction, setEventCancelledAction, setMarkAction,
} from './actions';
import { DAY_REQUIRED, KIND_REQUIRED } from './failure-messages';
import styles from './attendance.module.css';

type Refusal = { where: 'day' | 'kind' | 'form'; message: string };

const DAY_ID = 'attendance-day';
const KIND_ID = 'attendance-kind';

export function EventDrawer({
  event, seasonId, seasonName, closeHref, params, roster, present, presetDay = null,
}: {
  event: AttendanceEvent | null;
  seasonId: string;
  seasonName: string;
  closeHref: string;
  /** The page's URL params, so the drawer can reopen over a day it just made. */
  params: RawParams;
  /** The season's roster, by name. Ignored while creating — nothing to tick yet. */
  roster: readonly RosterMember[];
  /** Who is marked on this occasion, by person id. Ignored while creating. */
  present: readonly string[];
  /** A day to start the form on, `YYYY-MM-DD`. Today, usually. */
  presetDay?: string | null;
}) {
  const router = useRouter();
  const { show } = useToast();

  const [day, setDay] = useState(event?.heldOn ?? presetDay ?? '');
  const [kind, setKind] = useState<string>(event?.kind ?? '');
  const [title, setTitle] = useState(event?.title ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [pending, setPending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  /* Drawn ticked the moment it is ticked; the page's refresh brings the real
     state back under it. A set, because a lead goes down the list fast. */
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set(present));
  const [marking, setMarking] = useState<string | null>(null);

  function errorFor(where: Refusal['where']): string | undefined {
    return refusal?.where === where ? refusal.message : undefined;
  }

  async function save(formEvent?: FormEvent) {
    formEvent?.preventDefault();
    setRefusal(null);

    // The same refusals the library makes, in the same words, so a lead
    // finds out without a round trip.
    if (!isCivilDay(day)) { setRefusal({ where: 'day', message: DAY_REQUIRED }); return; }
    if (!ATTENDANCE_KINDS.includes(kind as AttendanceKind)) {
      setRefusal({ where: 'kind', message: KIND_REQUIRED });
      return;
    }

    const input = {
      kind: kind as AttendanceKind,
      heldOn: day,
      title: isBlank(title) ? null : title,
      notes: isBlank(notes) ? null : notes,
    };
    const name = eventLabel({ kind: input.kind, title: input.title?.trim() ?? null });

    setPending(true);
    try {
      if (event === null) {
        const result = await createEventAction(seasonId, input);
        if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }
        show({ message: `${name} נוסף ללוח הנוכחות`, tone: 'ok' });
        /* Straight into the new day rather than back to the board: the next
           thing a lead does with a day they just made is tick who came, and
           the drawer over it is where that happens. `value` is typed
           optional on every action result; this one always sets it. */
        router.push(result.value === undefined ? closeHref : eventHref(params, result.value));
        router.refresh();
        return;
      }

      const result = await updateEventAction(event.id, input);
      if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }
      show({ message: `${name} עודכן`, tone: 'ok' });
      router.push(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function setCancelled(cancelled: boolean) {
    if (event === null) return;
    setRefusal(null);
    setPending(true);
    try {
      const result = await setEventCancelledAction(event.id, cancelled);
      if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }
      show({
        message: cancelled ? `${eventLabel(event)} בוטל. הסימונים נשמרו` : `${eventLabel(event)} חזר ללוח`,
        tone: 'ok',
      });
      setCancelling(false);
      router.push(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function mark(member: RosterMember, next: boolean) {
    if (event === null) return;
    setMarking(member.personId);
    setMarked((before) => {
      const after = new Set(before);
      if (next) after.add(member.personId); else after.delete(member.personId);
      return after;
    });
    try {
      const result = await setMarkAction(event.id, member.personId, next);
      if (!result.ok) {
        setMarked((before) => {
          const after = new Set(before);
          if (next) after.delete(member.personId); else after.add(member.personId);
          return after;
        });
        show({ message: result.error, tone: 'bad' });
        return;
      }
      show({
        message: next
          ? `${member.displayName} סומן/ה כנוכח/ה ב${eventLabel(event)}`
          : `הסימון של ${member.displayName} ב${eventLabel(event)} הוסר`,
        tone: 'ok',
      });
      router.refresh();
    } finally {
      setMarking(null);
    }
  }

  const creating = event === null;
  const cancelled = event?.cancelledAt != null;

  return (
    <Drawer
      title={creating ? 'יום חדש בלוח הנוכחות' : eventLabel(event)}
      subtitle={creating ? `בלוח הנוכחות של ${seasonName}` : (
        <>
          {cancelled ? <><Pill tone="outline">בוטל</Pill>{' · '}</> : null}
          <bdi>{`${weekdayOf(event.heldOn)} `}</bdi>
          <DateText at={civilDate(event.heldOn)} form="full" />
          {' · עודכן לאחרונה '}
          <DateText at={event.updatedAt} />
          {event.updatedBy === null ? null : <>{' · '}{event.updatedBy}</>}
        </>
      )}
      closeHref={closeHref}
      width={500}
      phone="full"
      footer={(
        <span className={styles.footActions}>
          <Button tone="primary" onClick={() => { void save(); }} disabled={pending}>
            {creating ? 'הוספת היום' : 'שמירה'}
          </Button>
          <Button onClick={() => { router.push(closeHref); }} disabled={pending}>ביטול</Button>
          {creating ? null : cancelled ? (
            <Button tone="ghost" onClick={() => { void setCancelled(false); }} disabled={pending}>
              החזרה ללוח
            </Button>
          ) : (
            <Button tone="ghost" onClick={() => { setCancelling(true); }} disabled={pending}>
              ביטול היום
            </Button>
          )}
        </span>
      )}
    >
      <form className={styles.form} onSubmit={save}>
        <div className={styles.pair}>
          <Field id={DAY_ID} label="באיזה יום" required error={errorFor('day')}>
            {/* The kit ships no `date` control (its TextInput hard-codes
                type="text"), so this is a plain input drawn to match, inside
                the kit's Field for the label and aria wiring. */}
            <input
              className={styles.plainInput}
              id={DAY_ID}
              type="date"
              value={day}
              onChange={(changed) => { setDay(changed.target.value); }}
            />
          </Field>
          <Field id={KIND_ID} label="מה היה" required error={errorFor('kind')}>
            <Select
              id={KIND_ID}
              value={kind}
              onChange={setKind}
              emptyLabel="בחירה…"
              options={ATTENDANCE_KINDS.map((value) => ({ value, label: ATTENDANCE_KIND_LABELS[value] }))}
            />
          </Field>
        </div>

        <Field
          id="attendance-title"
          label="כותרת"
          hint="לא חובה. ״קניות באיקאה״, ״בניית הבר״ — מה שיזכיר לכולם איזה יום זה היה. בלי כותרת, העמודה בלוח תיקרא על שם הסוג."
        >
          <TextInput id="attendance-title" value={title} onChange={setTitle} />
        </Field>

        <Field id="attendance-notes" label="הערות">
          <Textarea id="attendance-notes" value={notes} onChange={setNotes} rows={2} />
        </Field>

        {refusal?.where === 'form' && (
          <p className={styles.formError} role="alert">{refusal.message}</p>
        )}
      </form>

      {creating ? null : (
        /*
          Who was there. A checklist rather than a table: a day has a handful
          to a few dozen names, and on a phone each row is a name and a box.
          Each tick writes at once and says so; the heading's count is the
          drawer's own set, so it moves with the ticks.
        */
        <section className={styles.roster} aria-labelledby="attendance-roster-heading">
          <h3 id="attendance-roster-heading" className={styles.rosterHeading}>
            {marked.size === 0 ? 'עדיין לא סומן אף אחד' : `נוכחים · ${marked.size} מתוך ${roster.length}`}
          </h3>
          {cancelled ? (
            <p className={styles.rosterNote}>
              היום הזה בוטל, והסימונים שלו לא נספרים. כדי לסמן שוב, מחזירים אותו ללוח.
            </p>
          ) : null}
          {roster.length === 0 ? (
            <p className={styles.rosterNote}>
              אין עדיין חברים ברשימת {seasonName}. מוסיפים אותם במסך אנשים, והם יופיעו כאן.
            </p>
          ) : (
            <ul className={styles.rosterList}>
              {roster.map((member) => (
                <li key={member.personId} className={styles.rosterRow}>
                  <Checkbox
                    id={`attendance-mark-${member.personId}`}
                    label={member.displayName}
                    checked={marked.has(member.personId)}
                    disabled={cancelled || marking === member.personId}
                    onChange={(next) => { void mark(member, next); }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {cancelling && event !== null ? (
        <ConfirmDialog
          title="ביטול יום בלוח הנוכחות"
          consequence={`${eventLabel(event)} יירד מהלוח, והסימונים שלו יפסיקו להיספר בסך של כל חבר. הסימונים עצמם נשמרים, ואפשר להחזיר את היום.`}
          confirmLabel="ביטול היום"
          onConfirm={() => { void setCancelled(true); }}
          onCancel={() => { setCancelling(false); }}
        />
      ) : null}
    </Drawer>
  );
}
