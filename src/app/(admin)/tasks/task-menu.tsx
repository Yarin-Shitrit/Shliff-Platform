'use client';

/**
 * A client component because spec R8 makes closing and cancelling a task
 * pass through a confirmation, and a confirmation is a dialog with focus
 * and an answer — not a link.
 *
 * Reopening sits in the same menu. `setTaskStatus` has always accepted
 * `'open'`; nothing ever offered it, so a cancelled task was cancelled for
 * good. A cancel that cannot be undone is exactly the irreversible
 * mis-click R8 exists to prevent, so the way back ships with the
 * confirmation. Reopening is not destructive and does not confirm.
 *
 * The panel carries no `role="menu"`. `menu` obliges every child to be a
 * `menuitem` and the whole thing to answer arrow keys with a roving
 * tabindex; claiming the role without the behaviour takes the `button` role
 * away from controls that really are buttons and gives nothing back. This is
 * the same call `popover.tsx` and `season-switch.tsx` already made.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { TaskKind, TaskStatus } from '@/db/schema/camp';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Select } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { setTaskStatusAction, setTaskBudgetLineAction } from './actions';
import styles from './tasks.module.css';

type Pending = 'close' | 'cancel' | null;

export function TaskMenu({
  taskId, title, status, kind, accepted, hasBudgetLine, budgetLines,
}: {
  taskId: string;
  title: string;
  status: TaskStatus;
  kind: TaskKind;
  accepted: number;
  hasBudgetLine: boolean;
  budgetLines: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<Pending>(null);
  const [lineId, setLineId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) { setError(result.error ?? 'הפעולה נכשלה. נסו שוב.'); return; }
      setOpen(false);
      router.refresh();
    });
  }

  const offersBudgetLine = kind === 'deliverable' && !hasBudgetLine
    && budgetLines.length > 0;
  const selectId = `task-budget-line-${taskId}`;

  return (
    <div className={styles.popoverHost}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label="אפשרויות"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="more" size={15} />
      </button>

      {open && (
        <div className={styles.menu} aria-label={`אפשרויות — ${title}`}>
          {status === 'open' ? (
            <>
              <button type="button" disabled={pending} onClick={() => setConfirming('close')}>
                סגירת המשימה
              </button>
              <button type="button" disabled={pending} onClick={() => setConfirming('cancel')}>
                ביטול המשימה
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setTaskStatusAction(taskId, 'open'))}
            >
              פתיחה מחדש
            </button>
          )}

          {offersBudgetLine && (
            <div className={styles.menuField}>
              <Field
                id={selectId}
                label="שיוך לסעיף תקציב"
                hint="הסכום מגיע מסעיף התקציב, לא מהמשימה."
              >
                <Select
                  id={selectId}
                  value={lineId}
                  emptyLabel="—"
                  options={budgetLines.map((line) => ({ value: line.id, label: line.label }))}
                  onChange={setLineId}
                />
              </Field>
              <button
                type="button"
                disabled={!lineId || pending}
                onClick={() => run(() => setTaskBudgetLineAction(taskId, lineId))}
              >
                שיוך
              </button>
            </div>
          )}

          {error && <p className="badge-warn" role="alert">{error}</p>}
        </div>
      )}

      {confirming === 'close' && (
        <ConfirmDialog
          title={`לסגור את המשימה "${title}"?`}
          consequence="המשימה תיסמן כהושלמה ותצא מספירת האיוש. אפשר לפתוח אותה מחדש."
          confirmLabel="סימון כהושלמה"
          cancelLabel="חזרה"
          tone="default"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            run(() => setTaskStatusAction(taskId, 'done'));
          }}
        />
      )}
      {confirming === 'cancel' && (
        <ConfirmDialog
          title={`לבטל את המשימה "${title}"?`}
          /* One isolate around the whole phrase (A17): split across two, a
             test that reads the sentence matches neither half. */
          consequence={(
            <bdi>
              {`${accepted} שיבוצים יישארו רשומים, אך המשימה תצא מספירת האיוש. `}
              אפשר לפתוח אותה מחדש.
            </bdi>
          )}
          confirmLabel="סימון כמבוטלת"
          cancelLabel="חזרה"
          tone="danger"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            run(() => setTaskStatusAction(taskId, 'cancelled'));
          }}
        />
      )}
    </div>
  );
}
