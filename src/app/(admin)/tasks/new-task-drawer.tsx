'use client';

/**
 * A client component because the fields depend on the kind: a shift's
 * window, an event task's event, a build's deadline, a deliverable's budget
 * line. Which fields exist changes as the lead picks, and that is state.
 *
 * Two things changed with the move into the drawer. The deliverable used to
 * send `budgetAmount`, a column the schema documents as "deprecated in
 * place… written by nothing"; it now picks a `budget_lines` row and sends
 * `budgetLineId`, which `createTask` already stores. And an event task is
 * no longer offered on a season with no events — picking it used to lead to
 * a select holding nothing but `—`, and a refusal after the fact.
 *
 * The date, time and count boxes are plain `<input>`s inside the kit's
 * `Field`: the kit ships `TextInput`, `MoneyInput`, `Select`, `Textarea`,
 * `Segmented` and `Checkbox`, and `TextInput` hard-codes `type="text"`, so
 * there is no kit control for `date`, `datetime-local` or `number` to reuse.
 * `Field` still owns the label, the hint and the aria wiring, so the part
 * that is a component stays one.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { isBlank } from '@/lib/text/normalize';
import { formatShekels } from '@/lib/money';
import type { TaskKind } from '@/db/schema/camp';
import { Field, Select, TextInput } from '@/components/ui/field';
import { createTaskAction } from './actions';
import styles from './tasks.module.css';

export interface EventOption { id: string; name: string }
export interface BudgetLineOption { id: string; label: string; totalAgorot: number }

const KIND_OPTIONS: Array<{ value: TaskKind; label: string }> = [
  { value: 'shift', label: 'משמרת' },
  { value: 'event_task', label: 'משימה באירוע' },
  { value: 'deliverable', label: 'אחריות תקציבית' },
  { value: 'build', label: 'הקמה ולוגיסטיקה' },
];

export function NewTaskForm({
  seasonId, seasonName, events, budgetLines, closeHref,
}: {
  seasonId: string;
  seasonName: string;
  events: EventOption[];
  budgetLines: BudgetLineOption[];
  closeHref: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<TaskKind>('shift');
  const [peopleNeeded, setPeopleNeeded] = useState('1');
  const [eventId, setEventId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [budgetLineId, setBudgetLineId] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    // The same three refusals the domain makes, made here so a lead finds
    // out before the round trip. Everything else is left to the action.
    if (isBlank(title)) { setError('כותרת לא יכולה להיות ריקה.'); return; }
    if (kind === 'shift' && (isBlank(startsAt) || isBlank(endsAt))) {
      setError('משמרת חייבת לכלול שעת התחלה ושעת סיום.'); return;
    }
    if (kind === 'event_task' && isBlank(eventId)) {
      setError('משימה באירוע חייבת להיות משויכת לאירוע.'); return;
    }

    const needed = Number(peopleNeeded);
    setPending(true);
    try {
      const result = await createTaskAction({
        seasonId,
        kind,
        title,
        peopleNeeded: Number.isFinite(needed) && needed > 0 ? needed : undefined,
        eventId: kind === 'event_task' ? eventId : undefined,
        startsAt: kind === 'shift' ? startsAt : undefined,
        endsAt: kind === 'shift' ? endsAt : undefined,
        budgetLineId: kind === 'deliverable' && !isBlank(budgetLineId)
          ? budgetLineId : undefined,
        dueOn: kind === 'build' && !isBlank(dueOn) ? dueOn : undefined,
      });
      if (result.ok) {
        router.push(closeHref);
        router.refresh();
      } else {
        setError(result.error);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className={styles.newTask}>
      <Field id="new-task-title" label="כותרת">
        <TextInput id="new-task-title" value={title} onChange={setTitle} />
      </Field>

      <Field
        id="new-task-kind"
        label="סוג"
        hint={events.length === 0
          ? `אין אירועים ב${seasonName}, ולכן אי אפשר ליצור עכשיו משימה באירוע. אירועים נוצרים בייבוא.`
          : undefined}
      >
        <Select
          id="new-task-kind"
          value={kind}
          onChange={(value) => setKind(value as TaskKind)}
          options={KIND_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
            disabled: option.value === 'event_task' && events.length === 0,
          }))}
        />
      </Field>

      <Field id="new-task-people" label="כמה אנשים נדרשים">
        <input
          className={styles.plainInput}
          id="new-task-people"
          type="number" min="1" step="1" value={peopleNeeded}
          onChange={(e) => setPeopleNeeded(e.target.value)}
        />
      </Field>

      {kind === 'shift' && (
        <>
          <Field id="new-task-starts" label="התחלה">
            <input
              className={styles.plainInput}
              id="new-task-starts"
              type="datetime-local" value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </Field>
          <Field id="new-task-ends" label="סיום">
            <input
              className={styles.plainInput}
              id="new-task-ends"
              type="datetime-local" value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </Field>
        </>
      )}

      {kind === 'event_task' && (
        <Field id="new-task-event" label="אירוע">
          <Select
            id="new-task-event"
            value={eventId}
            emptyLabel="—"
            onChange={setEventId}
            options={events.map((option) => ({ value: option.id, label: option.name }))}
          />
        </Field>
      )}

      {kind === 'deliverable' && (
        <Field
          id="new-task-line"
          label="סעיף תקציב"
          hint="הסכום מגיע מסעיף התקציב, לא מהמשימה."
        >
          <Select
            id="new-task-line"
            value={budgetLineId}
            emptyLabel="—"
            onChange={setBudgetLineId}
            /* `formatShekels`, never `${formatILS(x)} ₪` — money.ts forbids
               composing the sign at a call site, and an <option> cannot hold
               the <bdi> that <Money> would bring. */
            options={budgetLines.map((line) => ({
              value: line.id,
              label: `${line.label} — ${formatShekels(line.totalAgorot)}`,
            }))}
          />
        </Field>
      )}

      {kind === 'build' && (
        <Field id="new-task-due" label="מועד יעד (לא חובה)">
          <input
            className={styles.plainInput}
            id="new-task-due"
            type="date" value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
          />
        </Field>
      )}

      <button type="submit" disabled={pending}>הוספת משימה</button>
      {error && <p className="badge-warn" role="alert">{error}</p>}
    </form>
  );
}
