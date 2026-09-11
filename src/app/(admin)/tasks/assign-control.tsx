'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  assignPersonAction, setAssignmentStatusAction, removeAssignmentAction, setTaskStatusAction,
} from './actions';
import styles from './tasks.module.css';

export interface ControlAssignee {
  assignmentId: string;
  personId: string;
  displayName: string;
  status: string;
}

const STATUS_LABELS: Record<string, string> = {
  proposed: 'הוצע',
  accepted: 'אישר',
  done: 'בוצע',
  dropped: 'ירד',
};

const TASK_STATUS_LABELS: Record<string, string> = {
  open: 'פתוחה',
  done: 'הושלמה',
  cancelled: 'בוטלה',
};

/**
 * Staffs one task, and lets a lead close it out.
 *
 * `accepted` counts what a person has actually agreed to. A `proposed`
 * assignment shows here but does not close the gap — otherwise the coverage
 * report would call a shift staffed when nobody had said yes.
 *
 * Closing (`done`) or cancelling a task is only offered while it is `open` —
 * `coverageFor` already stops counting a non-open task as a gap, so nothing
 * here duplicates that rule, and staffing a task that is already done or
 * cancelled reads as pointless once it is no longer open.
 */
export function AssignControl({
  taskId, status, peopleNeeded, accepted, assignees, people,
}: {
  taskId: string;
  status: string;
  peopleNeeded: number;
  accepted: number;
  assignees: ControlAssignee[];
  people: Array<{ personId: string; displayName: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) router.refresh();
      else setError(result.error ?? 'שגיאה');
    });
  }

  const short = accepted < peopleNeeded;

  return (
    <div className={styles.assign}>
      <p className={short ? 'badge-warn' : 'muted'}>
        <bdi>{accepted} מתוך {peopleNeeded}</bdi>
      </p>

      <ul className={styles.assignees}>
        {assignees.map((assignee) => (
          <li key={assignee.assignmentId}>
            <bdi>{assignee.displayName}</bdi>
            <span className="muted"> — {STATUS_LABELS[assignee.status] ?? assignee.status}</span>
            {assignee.status === 'proposed' && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => setAssignmentStatusAction(assignee.assignmentId, 'accepted'))}
              >
                אישר
              </button>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => removeAssignmentAction(assignee.assignmentId))}
            >
              הסר
            </button>
          </li>
        ))}
      </ul>

      {status === 'open' ? (
        <>
          <label>
            הוסף אדם
            <select value={selected} onChange={(event) => setSelected(event.target.value)}>
              <option value="">—</option>
              {people.map((person) => (
                <option key={person.personId} value={person.personId}>
                  {person.displayName}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={() => { if (selected) run(() => assignPersonAction(taskId, selected)); }}
          >
            שבץ
          </button>

          <div className={styles.taskStatusControls}>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setTaskStatusAction(taskId, 'done'))}
            >
              סגור משימה
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setTaskStatusAction(taskId, 'cancelled'))}
            >
              בטל משימה
            </button>
          </div>
        </>
      ) : (
        <p className="muted">משימה {TASK_STATUS_LABELS[status] ?? status}</p>
      )}

      {error && <p className="badge-warn" role="alert">{error}</p>}
    </div>
  );
}
