import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons } from '@/lib/members/roster';
import { coverageFor, rosterWorkload, summarize } from '@/lib/work/coverage';
import type { TaskCoverage } from '@/lib/work/coverage';
import { listEvents } from '@/lib/work/events';
import { listBudgetLines } from '@/lib/money/budget';
import { Money } from '@/components/format';
import { Table, type TableRowModel } from '@/components/ui/table';
import { SavedViews } from '@/components/ui/saved-views';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { Drawer } from '@/components/ui/drawer';
import { closePeekHref } from '@/components/ui/drawer-url';
import { Icon } from '@/components/ui/icon';
import { GateOpens } from './gate-note';
import { NewTaskForm } from './new-task-drawer';
import { taskColumns, taskRowActions } from './task-row';
import {
  asTaskView, filterTasks, groupByKind, tasksHref, type TaskView,
} from './rows';
import styles from './tasks.module.css';

export const dynamic = 'force-dynamic';

/** Spec B8: every page names itself. */
export const metadata: Metadata = { title: 'משימות' };

export default async function TasksPage(
  { searchParams }: {
    searchParams: Promise<{ season?: string; view?: string; act?: string }>;
  },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const seasons = await listSeasons(db);
  if (seasons.length === 0) {
    return (
      <main>
        <h1>משימות</h1>
        <EmptyState
          kind="nothing-yet"
          noun="שנים"
          action={{ label: 'ייבוא מהגיליון', href: '/imports' }}
        />
      </main>
    );
  }

  const params = await searchParams;
  // The season is a URL parameter (R5); the sidebar writes it. The fallback
  // to the newest season is what the page has always done.
  const season = seasons.find((option) => option.id === params.season) ?? seasons[0];
  const view: TaskView = asTaskView(params.view);
  const here = { season: season.id, view: params.view };

  const rows = await coverageFor(db, season.id);
  const totals = summarize(rows);
  const candidates = await rosterWorkload(db, season.id);
  const events = await listEvents(db, season.id);
  const budgetLines = await listBudgetLines(db, season.id);
  const lineOptions = budgetLines.map((line) => ({ id: line.id, label: line.label }));

  const visible = filterTasks(rows, view);
  const groups = groupByKind(visible);
  const unfilled = totals.placesNeeded - totals.placesFilled;

  const context = {
    seasonName: season.name, gate: season.startsOn, candidates, budgetLines: lineOptions,
  };
  /**
   * The kit's `Table` emits a group heading whenever `group` changes, and the
   * rows arrive already ordered — `groupByKind` fixed both the group order and
   * the gap-first order inside each one, so flattening here cannot disturb it.
   * The count travels inside the heading string because that is all the kit's
   * group row holds.
   */
  const tableRows: Array<TableRowModel<TaskCoverage>> = groups.flatMap((group) =>
    group.rows.map((row) => ({
      id: row.taskId,
      data: row,
      group: `${group.label} · ${group.rows.length} משימות`,
      tone: row.uncovered ? ('warn' as const) : undefined,
    })),
  );

  // `?act=task` with no `?peek=`: a create drawer has no record (§5 A3), and
  // the param is the kit's, not this screen's to spell.
  const drawerOpen = params.act === 'task';
  const closeHref = closePeekHref('/tasks', new URLSearchParams(
    Object.entries(params).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  ));

  return (
    <main>
      <div className={styles.head}>
        <div>
          <h1>משימות</h1>
          {/* One isolate per phrase, not one per number (A17). */}
          <p className="muted">
            <bdi>{`${totals.placesFilled} מתוך ${totals.placesNeeded} מקומות מאוישים`}</bdi>
            {' · '}
            <bdi>{`${totals.uncoveredTasks} משימות עדיין חסרות אנשים`}</bdi>
            {season.startsOn && <>{' · '}<GateOpens gate={season.startsOn} /></>}
          </p>
        </div>
        <Link className={styles.primary} href={tasksHref(here, { open: 'new' })}>
          <Icon name="plus" size={14} />
          משימה חדשה
        </Link>
      </div>

      <SavedViews
        label="תצוגות"
        currentId={view}
        views={[
          { id: 'all', href: tasksHref(here, { view: 'all' }), label: 'הכול', count: totals.tasks },
          { id: 'gaps', href: tasksHref(here, { view: 'gaps' }), label: 'חסרים אנשים', count: totals.uncoveredTasks },
          { id: 'covered', href: tasksHref(here, { view: 'covered' }), label: 'מאוישות', count: totals.openTasks - totals.uncoveredTasks },
          { id: 'undated', href: tasksHref(here, { view: 'undated' }), label: 'בלי תאריך', count: totals.datelessTasks },
        ]}
      />

      {unfilled > 0 && (
        <Banner
          tone="warn"
          headline={<bdi>{`${unfilled} מקומות עדיין לא מאוישים`}</bdi>}
          detail="מה שלא יאויש עד פתיחת השער — יתגלה בשטח."
          action={{ label: 'שיבוץ מהיר', href: tasksHref(here, { view: 'gaps' }) }}
        />
      )}

      {rows.length === 0 ? (
        <EmptyState
          kind="nothing-this-season"
          noun="משימות"
          seasonName={season.name}
          action={{ label: 'משימה חדשה', href: tasksHref(here, { open: 'new' }) }}
        />
      ) : (
        <Table
          caption={`משימות ${season.name}`}
          columns={taskColumns(context)}
          rowActions={taskRowActions(context)}
          rows={tableRows}
          empty={view === 'gaps' ? (
            <EmptyState kind="all-clear" />
          ) : (
            <EmptyState
              kind="no-matches"
              action={{ label: 'הצגת כל המשימות', href: tasksHref(here, { view: 'all' }) }}
            />
          )}
          totals={[
            { key: 'count', content: <bdi>{`${visible.length} משימות`}</bdi> },
            { key: 'when', content: <bdi>{`מהן ${totals.datelessTasks} בלי תאריך`}</bdi> },
            { key: 'team', content: null },
            {
              key: 'coverage',
              content: <bdi>{`${totals.placesFilled}/${totals.placesNeeded} מקומות`}</bdi>,
            },
            { key: 'budget', content: <Money agorot={totals.linkedBudgetAgorot} />, numeric: true },
            { key: 'actions', content: null },
          ]}
        />
      )}

      {drawerOpen && (
        <Drawer title="משימה חדשה" subtitle={season.name} closeHref={closeHref}>
          <NewTaskForm
            seasonId={season.id}
            seasonName={season.name}
            events={events.map((event) => ({ id: event.id, name: event.name }))}
            budgetLines={budgetLines.map((line) => ({
              id: line.id, label: line.label, totalAgorot: line.totalAgorot,
            }))}
            closeHref={closeHref}
          />
        </Drawer>
      )}
    </main>
  );
}
