import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { Pill } from '@/components/ui/pill';
import { AvatarStack } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { covers } from '@/lib/work/coverage';
import type { SeasonCoverage, TaskCoverage } from '@/lib/work/coverage';
import { TASK_KIND_LABELS } from '@/lib/work/labels';
import styles from './home.module.css';

/** The first few rows only — the panel points at the board for the rest. */
const SHOWN = 4;

/**
 * The tasks still short of people, biggest gap first.
 *
 * The row says which kind of work it is and, for an event task, which event —
 * not how many days before the gate it falls. That reading belongs to the task
 * board (D9), it needs the season's gate day, and a second implementation of it
 * here would drift from the board's.
 *
 * Returns nothing at all when the season has no open task. That is
 * `coverage === null`, which the summary already distinguishes from "there are
 * tasks and all of them are staffed" — celebrating over a season nobody has
 * made a task for congratulates the camp for work it has not started, which is
 * the same lie the unpaid panel refuses.
 */
export function Understaffed({ tasks, coverage, seasonId, seasonName }: {
  tasks: TaskCoverage[];
  coverage: SeasonCoverage | null;
  seasonId: string;
  seasonName: string;
}) {
  if (!coverage) return null;
  const shown = tasks.slice(0, SHOWN);
  const hidden = coverage.uncoveredTasks - shown.length;

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <Icon name="tasks" size={16} />
        <h2>חסרים אנשים</h2>
        <bdi className={styles.scope}>{seasonName}</bdi>
        <Link className={styles.more} href={`/tasks?season=${seasonId}`}>
          לכל המשימות ←
        </Link>
      </div>

      {shown.length === 0 ? (
        <div className={styles.emptyBody}>
          <EmptyState kind="all-clear" />
        </div>
      ) : (
        <ul className={styles.rows}>
          {shown.map((row) => (
            <li key={row.taskId} className={styles.row}>
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>{row.title}</span>
                <span className={styles.rowDetail}>
                  {TASK_KIND_LABELS[row.kind]}
                  {row.eventName ? ` · ${row.eventName}` : ''}
                </span>
              </span>
              <AvatarStack
                size="sm"
                max={3}
                label={`השיבוץ ל${row.title}`}
                /* `covers` rather than a second list of statuses: the avatars
                   and the fraction beside them read the same rule, so they
                   cannot disagree about who is on a task. */
                people={row.assignees
                  .filter((one) => covers(one.status))
                  .map((one) => ({ id: one.personId, name: one.displayName }))}
                emptySlots={Math.max(0, row.peopleNeeded - row.accepted)}
              />
              {/* R3: the pill carries the fraction as a word-equivalent, so the
                  tone is never the only thing saying "nobody is on this". */}
              <bdi>
                <Pill tone={row.accepted === 0 ? 'bad' : 'warn'}>
                  {`${row.accepted}/${row.peopleNeeded}`}
                </Pill>
              </bdi>
            </li>
          ))}
        </ul>
      )}

      {hidden > 0 ? (
        <div className={styles.panelFoot}>
          <bdi>
            {hidden === 1
              ? 'ועוד משימה אחת חסרה אנשים'
              : `ועוד ${hidden} משימות חסרות אנשים`}
          </bdi>
          <Link className={styles.more} href={`/tasks?season=${seasonId}`}>
            לדף המשימות
          </Link>
        </div>
      ) : null}
    </section>
  );
}
