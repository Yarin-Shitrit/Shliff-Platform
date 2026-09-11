'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { isBlank } from '@/lib/text/normalize';
import type { TaskKind } from '@/db/schema/camp';
import { createTaskAction } from './actions';
import styles from './tasks.module.css';

export interface EventOption {
  id: string;
  name: string;
}

const KIND_OPTIONS: Array<{ value: TaskKind; label: string }> = [
  { value: 'shift', label: 'משמרת' },
  { value: 'event_task', label: 'משימה באירוע' },
  { value: 'deliverable', label: 'אחריות תקציבית' },
  { value: 'build', label: 'הקמה ולוגיסטיקה' },
];

/**
 * Adds work to a season.
 *
 * Only the fields the chosen kind actually uses are shown — a shift's time
 * window, an event task's event, a deliverable's optional budget, a build's
 * optional deadline. A shift with no window and an event task with no event
 * are refused client-side, matching `@/lib/work/tasks`'s own rule, so a lead
 * finds out before submitting rather than from a round trip. Everything else
 * the domain enforces (an end before a start, at least one person needed) is
 * left to `createTaskAction`'s own error — this form does not duplicate it.
 */
export function NewTaskForm({
  seasonId, events,
}: {
  seasonId: string;
  events: EventOption[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<TaskKind>('shift');
  const [peopleNeeded, setPeopleNeeded] = useState('1');
  const [eventId, setEventId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [budget, setBudget] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (isBlank(title)) {
      setError('כותרת לא יכולה להיות ריקה.');
      return;
    }
    if (kind === 'shift' && (isBlank(startsAt) || isBlank(endsAt))) {
      setError('משמרת חייבת לכלול שעת התחלה ושעת סיום.');
      return;
    }
    if (kind === 'event_task' && isBlank(eventId)) {
      setError('משימה באירוע חייבת להיות משויכת לאירוע.');
      return;
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
        budgetAmount: kind === 'deliverable' && !isBlank(budget) ? Number(budget) : undefined,
        dueOn: kind === 'build' && !isBlank(dueOn) ? dueOn : undefined,
      });
      if (result.ok) {
        setTitle('');
        setPeopleNeeded('1');
        setEventId('');
        setStartsAt('');
        setEndsAt('');
        setBudget('');
        setDueOn('');
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
      <label>
        כותרת
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>

      <label>
        סוג
        <select value={kind} onChange={(event) => setKind(event.target.value as TaskKind)}>
          {KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      <label>
        כמה אנשים נדרשים
        <input
          type="number"
          min="1"
          step="1"
          value={peopleNeeded}
          onChange={(event) => setPeopleNeeded(event.target.value)}
        />
      </label>

      {kind === 'shift' && (
        <>
          <label>
            התחלה
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </label>
          <label>
            סיום
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </label>
        </>
      )}

      {kind === 'event_task' && (
        <label>
          אירוע
          <select value={eventId} onChange={(event) => setEventId(event.target.value)}>
            <option value="">—</option>
            {events.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        </label>
      )}

      {kind === 'deliverable' && (
        <label>
          תקציב (לא חובה)
          <input
            type="number"
            min="0"
            step="0.01"
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
          />
        </label>
      )}

      {kind === 'build' && (
        <label>
          מועד יעד (לא חובה)
          <input
            type="date"
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
          />
        </label>
      )}

      <button type="submit" disabled={pending}>הוסף משימה</button>
      {error && <p className="badge-warn" role="alert">{error}</p>}
    </form>
  );
}
