import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons } from '@/lib/members/roster';
import { coverageFor } from '@/lib/work/coverage';
import { listEvents } from '@/lib/work/events';
import { listPeople } from '@/lib/members/dossier';
import { formatILS } from '@/lib/money';
import { AssignControl } from './assign-control';
import { NewTaskForm } from './new-task-form';
import styles from './tasks.module.css';

export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<string, string> = {
  deliverable: 'אחריות תקציבית',
  shift: 'משמרות',
  build: 'הקמה ולוגיסטיקה',
  event_task: 'משימות באירועים',
};

/** he-IL, date and time together — a shift's "when" is never just a day. */
function formatDateTime(date: Date): string {
  return date.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
}

export default async function TasksPage(
  { searchParams }: { searchParams: Promise<{ season?: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const seasons = await listSeasons(db);
  if (seasons.length === 0) {
    return (
      <main>
        <h1>משימות</h1>
        <p className="muted">עדיין אין שנים. הריצו את הזריעה מדף הייבוא.</p>
      </main>
    );
  }

  const { season: requested } = await searchParams;
  const season = seasons.find((s) => s.id === requested) ?? seasons[0];
  const coverage = await coverageFor(db, season.id);
  const events = await listEvents(db, season.id);
  const people = await listPeople(db);
  const roster = people.map((p) => ({ personId: p.personId, displayName: p.displayName }));

  const uncovered = coverage.filter((task) => task.uncovered);
  const byKind = new Map<string, typeof coverage>();
  for (const task of coverage) {
    byKind.set(task.kind, [...(byKind.get(task.kind) ?? []), task]);
  }

  return (
    <main>
      <h1>משימות</h1>

      <nav className={styles.seasons} aria-label="בחירת שנה">
        {seasons.map((option) => (
          <Link
            key={option.id}
            href={`/tasks?season=${option.id}`}
            aria-current={option.id === season.id ? 'page' : undefined}
          >
            {option.name}
          </Link>
        ))}
      </nav>

      <section className="card">
        <h2>הוספת משימה</h2>
        <NewTaskForm
          seasonId={season.id}
          events={events.map((event) => ({ id: event.id, name: event.name }))}
        />
      </section>

      <section className="card">
        <h2>חסרים אנשים</h2>
        <p className="muted">
          מה שלא יאויש עד פתיחת השער — כאן, לפני שמישהו מגלה את זה בשטח.
        </p>
        {uncovered.length === 0 ? (
          <p className="muted">כל המשימות מאוישות.</p>
        ) : (
          <ul>
            {uncovered.map((task) => (
              <li key={task.taskId}>
                {task.title}
                <span className="muted">
                  {' — '}{KIND_LABELS[task.kind] ?? task.kind}
                  {task.kind === 'shift' && task.startsAt && task.endsAt && (
                    <>
                      {', '}<bdi>{formatDateTime(task.startsAt)}</bdi>
                      {' – '}<bdi>{formatDateTime(task.endsAt)}</bdi>
                    </>
                  )}
                  {task.kind === 'build' && task.dueOn && (
                    <>{', עד '}<bdi>{formatDateTime(task.dueOn)}</bdi></>
                  )}
                  {', '}<bdi>{task.accepted} מתוך {task.peopleNeeded}</bdi>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {[...byKind.entries()].map(([kind, group]) => (
        <section key={kind}>
          <h2>{KIND_LABELS[kind] ?? kind}</h2>
          {group.map((task) => (
            <article key={task.taskId} className="card">
              <h3>{task.title}</h3>
              <p className="muted">
                {task.eventName && <><bdi>{task.eventName}</bdi>{' · '}</>}
                {task.kind === 'shift' && task.startsAt && task.endsAt && (
                  <>
                    <bdi>{formatDateTime(task.startsAt)}</bdi>
                    {' – '}<bdi>{formatDateTime(task.endsAt)}</bdi>{' · '}
                  </>
                )}
                {task.kind === 'build' && task.dueOn && (
                  <>עד <bdi>{formatDateTime(task.dueOn)}</bdi>{' · '}</>
                )}
                {task.budgetAgorot !== null && (
                  <>תקציב <bdi>{formatILS(task.budgetAgorot)} ₪</bdi></>
                )}
              </p>
              <AssignControl
                taskId={task.taskId}
                status={task.status}
                peopleNeeded={task.peopleNeeded}
                accepted={task.accepted}
                assignees={task.assignees}
                people={roster}
              />
            </article>
          ))}
        </section>
      ))}

      {coverage.length === 0 && (
        /*
         * Name the season. The default is the newest one, which early in a
         * planning year legitimately has no work on it yet — but an unnamed
         * "no tasks" reads as a broken page rather than an empty year, and
         * the reader has no reason to suspect the picker above holds the
         * answer.
         */
        <p className="muted">
          אין עדיין משימות ל<bdi>{season.name}</bdi>. אם חיפשתם שנה אחרת,
          בחרו אותה למעלה.
        </p>
      )}
    </main>
  );
}
