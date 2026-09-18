'use client';

/**
 * A client component because staffing a task is a conversation, not a
 * navigation: a lead searches, ticks two or three names, and assigns them
 * in one action. Holding the search text and the ticks in the URL would put
 * a history entry behind every keystroke.
 *
 * The candidates are the season's roster with its load
 * (`rosterWorkload`), computed once for the whole page. The old control
 * took `listPeople(db)` — every person in the database — and offered no way
 * to tell who was already carrying four shifts.
 *
 * Hand-rolled rather than built on the kit's `Popover`: that component closes
 * its panel on any click that lands inside an `a` or a `button`, which is
 * right for a panel of filter links and fatal for a multi-select — the first
 * name ticked would dismiss the panel. Integration §5 A3 already records that
 * this screen's popovers are `useState`-driven with their own `Escape`
 * handler, because I9 governs drawers and not popovers.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { normalizeHebrew } from '@/lib/text/normalize';
import type { Assignee, RosterCandidate } from '@/lib/work/coverage';
import { Avatar } from '@/components/ui/avatar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import {
  assignPeopleAction, setAssignmentStatusAction, removeAssignmentAction,
} from './actions';
import styles from './tasks.module.css';

/**
 * Every label states a fact about the שיבוץ — a masculine noun — and none
 * inflects on the person holding it (I12/A9). The roster is mixed, so
 * `אישר` and `ירד` would be wrong for half of it; `אושר` and `בוטל` are
 * right for all of it.
 */
const STATUS_LABELS: Record<string, string> = {
  proposed: 'בהמתנה לאישור',
  accepted: 'אושר',
  done: 'בוצע',
  dropped: 'בוטל',
};

export function AssignPopover({
  taskId, title, seasonName, peopleNeeded, accepted, assignees, candidates,
  variant = 'button',
}: {
  taskId: string;
  title: string;
  seasonName: string;
  peopleNeeded: number;
  accepted: number;
  assignees: Assignee[];
  candidates: RosterCandidate[];
  variant?: 'button' | 'slot';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [removing, setRemoving] = useState<Assignee | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) { setError(result.error ?? 'הפעולה נכשלה. נסו שוב.'); return; }
      setPicked([]);
      setOpen(false);
      router.refresh();
    });
  }

  const onTask = new Set(assignees.map((assignee) => assignee.personId));
  const needle = normalizeHebrew(query);
  const matching = candidates.filter(
    (candidate) => !needle || normalizeHebrew(candidate.displayName).includes(needle),
  );
  // `rosterWorkload` already sorts by load, so the two sections are a split
  // of one ordering rather than two queries.
  const free = matching.filter((candidate) => candidate.taskCount === 0);
  const loaded = matching.filter((candidate) => candidate.taskCount > 0);

  function toggle(personId: string) {
    if (onTask.has(personId)) return;
    setPicked((current) => (current.includes(personId)
      ? current.filter((id) => id !== personId)
      : [...current, personId]));
  }

  function candidateRow(candidate: RosterCandidate) {
    const already = onTask.has(candidate.personId);
    const meta = already
      ? 'כבר במשימה הזו'
      : candidate.taskCount === 0
        ? `ב${seasonName} · 0 משימות`
        : `כבר ב־${candidate.taskCount} משימות`;
    return (
      <button
        key={candidate.personId}
        type="button"
        className={styles.candidate}
        aria-pressed={picked.includes(candidate.personId)}
        disabled={already || pending}
        onClick={() => toggle(candidate.personId)}
      >
        <Avatar name={candidate.displayName} size="sm" />
        <bdi>{candidate.displayName}</bdi>
        {/* One isolate around the whole phrase, not one per number (A17). */}
        <span className={styles.candidateMeta}><bdi>{meta}</bdi></span>
      </button>
    );
  }

  return (
    <div className={styles.popoverHost}>
      <button
        ref={trigger}
        type="button"
        className={variant === 'slot' ? styles.slotTrigger : styles.iconButton}
        aria-label="שיבוץ"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {variant === 'slot'
          ? <Avatar empty size="sm" label="" />
          : <Icon name="userplus" size={15} />}
      </button>

      {open && (
        <div className={styles.popover} role="dialog" aria-label={`שיבוץ — ${title}`}>
          <p className={styles.popoverHead}>
            <bdi>{`${accepted} מתוך ${peopleNeeded}`}</bdi>
          </p>

          {assignees.length > 0 && (
            <ul className={styles.assigned}>
              {assignees.map((assignee) => (
                <li key={assignee.assignmentId}>
                  <Avatar name={assignee.displayName} size="sm" />
                  <bdi>{assignee.displayName}</bdi>
                  <span className={styles.candidateMeta}>
                    {STATUS_LABELS[assignee.status] ?? assignee.status}
                  </span>
                  {assignee.status === 'proposed' && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(
                        () => setAssignmentStatusAction(assignee.assignmentId, 'accepted'),
                      )}
                    >
                      אשרו
                    </button>
                  )}
                  <button type="button" disabled={pending} onClick={() => setRemoving(assignee)}>
                    הסרה
                  </button>
                </li>
              ))}
            </ul>
          )}

          {candidates.length === 0 ? (
            <EmptyState
              kind="nothing-this-season"
              noun="חברי קאמפ"
              seasonName={seasonName}
              action={{ label: 'הוספת חברים לשנה', href: '/members' }}
            />
          ) : (
            <>
              <label className={styles.popoverSearch}>
                <span className="sr-only">חיפוש חבר</span>
                <Icon name="search" size={15} />
                <input
                  type="search"
                  value={query}
                  placeholder="חיפוש חבר…"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>

              {free.length > 0 && (
                <>
                  <p className={styles.popoverSection}>מומלצים — לא משובצים לשום משימה</p>
                  {free.map(candidateRow)}
                </>
              )}
              {loaded.length > 0 && (
                <>
                  <p className={styles.popoverSection}>עוד מהקאמפ</p>
                  {loaded.map(candidateRow)}
                </>
              )}

              <div className={styles.popoverFoot}>
                <button
                  type="button"
                  disabled={picked.length === 0 || pending}
                  onClick={() => run(() => assignPeopleAction(taskId, picked))}
                >
                  {`שיבוץ ${picked.length}`}
                </button>
              </div>
            </>
          )}

          {error && <p className="badge-warn" role="alert">{error}</p>}
        </div>
      )}

      {/* The kit's ConfirmDialog has no `open` prop: it is mounted when there
          is something to confirm, and its confirm label is the verbal noun the
          kit asks for — which is also the one form that does not inflect. */}
      {removing !== null && (
        <ConfirmDialog
          title={`להסיר את ${removing.displayName} מ"${title}"?`}
          consequence="השיבוץ יימחק והמקום יחזור להיות פנוי."
          confirmLabel="הסרת השיבוץ"
          tone="danger"
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const { assignmentId } = removing;
            setRemoving(null);
            run(() => removeAssignmentAction(assignmentId));
          }}
        />
      )}
    </div>
  );
}
