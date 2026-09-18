import { and, asc, eq, ne } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import {
  tasks, taskAssignments, persons, seasons, campEvents,
} from '@/db/schema/camp';
import type { AssignmentStatus, TaskKind, TaskStatus } from '@/db/schema/camp';
import { budgetLines } from '@/db/schema/money';
import { toAgorot } from '@/lib/money';
import { taskWhen } from '@/lib/work/gate';

/** Only these count toward `peopleNeeded`. A `proposed` assignment is a lead's
 *  intention, not a commitment — counting it would report a shift as staffed
 *  when nobody has agreed to work it. */
const COUNTS_AS_COVERED: AssignmentStatus[] = ['accepted', 'done'];

/** The one place that decides whether an assignment counts. The avatar
 *  stack on `/tasks` asks this rather than re-listing the statuses, so the
 *  chips and the `5/8` can never disagree. */
export function covers(status: AssignmentStatus): boolean {
  return COUNTS_AS_COVERED.includes(status);
}

export interface Assignee {
  assignmentId: string;
  personId: string;
  displayName: string;
  status: AssignmentStatus;
}

export interface TaskCoverage {
  taskId: string;
  title: string;
  kind: TaskKind;
  status: TaskStatus;
  peopleNeeded: number;
  /** Assignments in `accepted` or `done`. */
  accepted: number;
  uncovered: boolean;
  eventName: string | null;
  /**
   * The kind-specific columns travel with the coverage row on purpose. Without
   * them the task board has to query listTasks for the same season a second
   * time just to show a budget, and a shift is unreadable — you cannot tell a
   * recurring `משמרת בר` apart from another except by when it runs.
   */
  budgetAgorot: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  dueOn: Date | null;
  assignees: Assignee[];
  /** When the event this task hangs off is held — an event task's only
   *  date. Carried here for the same reason the kind-specific columns
   *  above are: otherwise the board queries the events a second time. */
  eventHeldOn: Date | null;
  /** The `budget_lines` row a deliverable spends against. `budgetAgorot`
   *  above is the deprecated per-task figure, kept for rows written before
   *  budget lines existed; the screen prefers these three. */
  budgetLineId: string | null;
  budgetLineLabel: string | null;
  budgetLineTotalAgorot: number | null;
}

export interface Responsibility {
  taskId: string;
  title: string;
  kind: TaskKind;
  seasonName: string;
  eventName: string | null;
  budgetAgorot: number | null;
  /** So a person's own list can say *when* — a shift with no time on it does
   *  not answer "what am I responsible for" in any useful sense. */
  startsAt: Date | null;
  endsAt: Date | null;
  dueOn: Date | null;
  status: AssignmentStatus;
}

/**
 * Assigns one person to one task.
 *
 * Refuses a person who was merged away. `mergePersons` already refuses to
 * merge someone who has an assignment, but nothing stopped a *new* assignment
 * landing on the merged-away id afterwards — and such a row is the worst of
 * both worlds: counted as staffed on the board, yet invisible on every page a
 * lead would look at, because `listPeople` and `resolveName` both hide merged
 * rows. The work would be quietly covered and quietly unreachable.
 */
export async function assignPerson(
  db: AnyDb, taskId: string, personId: string, email: string,
  status: AssignmentStatus = 'proposed',
): Promise<string> {
  const [person] = await db.select({ mergedIntoId: persons.mergedIntoId })
    .from(persons).where(eq(persons.id, personId));
  if (!person) throw new Error(`unknown person ${personId}`);
  if (person.mergedIntoId) {
    throw new Error('that person was merged into another — assign the survivor');
  }

  const [row] = await db.insert(taskAssignments)
    .values({ taskId, personId, status, assignedBy: email })
    .returning();
  return row.id;
}

export async function setAssignmentStatus(
  db: AnyDb, assignmentId: string, status: AssignmentStatus,
): Promise<void> {
  await db.update(taskAssignments).set({ status })
    .where(eq(taskAssignments.id, assignmentId));
}

export async function removeAssignment(db: AnyDb, assignmentId: string): Promise<void> {
  await db.delete(taskAssignments).where(eq(taskAssignments.id, assignmentId));
}

export async function coverageFor(db: AnyDb, seasonId: string): Promise<TaskCoverage[]> {
  const taskRows = await db
    .select({
      taskId: tasks.id,
      title: tasks.title,
      kind: tasks.kind,
      status: tasks.status,
      peopleNeeded: tasks.peopleNeeded,
      eventName: campEvents.name,
      eventHeldOn: campEvents.heldOn,
      budgetAmount: tasks.budgetAmount,
      budgetLineId: tasks.budgetLineId,
      budgetLineLabel: budgetLines.label,
      budgetLineTotal: budgetLines.total,
      startsAt: tasks.startsAt,
      endsAt: tasks.endsAt,
      dueOn: tasks.dueOn,
    })
    .from(tasks)
    .leftJoin(campEvents, eq(campEvents.id, tasks.eventId))
    .leftJoin(budgetLines, eq(budgetLines.id, tasks.budgetLineId))
    .where(eq(tasks.seasonId, seasonId))
    // `tasks.id` breaks ties: title is not unique, and recurring shifts share
    // one. Without it Postgres may reorder equal keys between calls.
    .orderBy(asc(tasks.kind), asc(tasks.title), asc(tasks.id));

  const assignmentRows = await db
    .select({
      assignmentId: taskAssignments.id,
      taskId: taskAssignments.taskId,
      personId: taskAssignments.personId,
      displayName: persons.displayName,
      status: taskAssignments.status,
    })
    .from(taskAssignments)
    .innerJoin(persons, eq(persons.id, taskAssignments.personId))
    .innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
    .where(eq(tasks.seasonId, seasonId))
    .orderBy(asc(persons.displayName));

  const byTask = new Map<string, Assignee[]>();
  for (const row of assignmentRows) {
    const list = byTask.get(row.taskId) ?? [];
    list.push({
      assignmentId: row.assignmentId,
      personId: row.personId,
      displayName: row.displayName,
      status: row.status,
    });
    byTask.set(row.taskId, list);
  }

  return taskRows.map(({ budgetAmount, budgetLineTotal, ...task }) => {
    const assignees = byTask.get(task.taskId) ?? [];
    const accepted = assignees.filter((a) => covers(a.status)).length;
    return {
      ...task,
      budgetAgorot: budgetAmount === null ? null : toAgorot(budgetAmount),
      budgetLineTotalAgorot: budgetLineTotal === null ? null : toAgorot(budgetLineTotal),
      accepted,
      uncovered: task.status === 'open' && accepted < task.peopleNeeded,
      assignees,
    };
  });
}

/** The question that must be answerable before the gate opens. */
export async function uncoveredTasks(
  db: AnyDb, seasonId: string,
): Promise<TaskCoverage[]> {
  return (await coverageFor(db, seasonId)).filter((task) => task.uncovered);
}

/**
 * Everything one person is on the hook for, across all four kinds and every
 * season. This is the `אופק → חשמל` + `אופק → הובלה` query — one call, not a
 * four-way union.
 */
export async function responsibilitiesOf(
  db: AnyDb, personId: string,
): Promise<Responsibility[]> {
  const rows = await db
    .select({
      taskId: tasks.id,
      title: tasks.title,
      kind: tasks.kind,
      seasonName: seasons.name,
      eventName: campEvents.name,
      budgetAmount: tasks.budgetAmount,
      startsAt: tasks.startsAt,
      endsAt: tasks.endsAt,
      dueOn: tasks.dueOn,
      status: taskAssignments.status,
    })
    .from(taskAssignments)
    .innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
    .innerJoin(seasons, eq(seasons.id, tasks.seasonId))
    .leftJoin(campEvents, eq(campEvents.id, tasks.eventId))
    .where(and(
      eq(taskAssignments.personId, personId),
      ne(taskAssignments.status, 'dropped'),
    ))
    .orderBy(asc(seasons.year), asc(tasks.title), asc(tasks.id));

  return rows.map((row) => ({
    taskId: row.taskId,
    title: row.title,
    kind: row.kind,
    seasonName: row.seasonName,
    eventName: row.eventName,
    budgetAgorot: row.budgetAmount === null ? null : toAgorot(row.budgetAmount),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    dueOn: row.dueOn,
    status: row.status,
  }));
}

export interface SeasonCoverage {
  /** Every task in the season, whatever its status. */
  tasks: number;
  openTasks: number;
  uncoveredTasks: number;
  placesNeeded: number;
  placesFilled: number;
  datelessTasks: number;
  linkedBudgetAgorot: number;
}

/**
 * The season's staffing in one sentence — `16 מתוך 32 מקומות`.
 *
 * Pure, and derived from the rows `coverageFor` already returned, so the
 * tasks screen pays for one round trip and the home screen's coverage tile
 * (spec D1) and the sidebar's משימות count (B2) reuse this arithmetic
 * rather than re-deriving it. Only `open` tasks contribute places, which is
 * the rule `uncovered` already applies.
 */
export function summarize(rows: TaskCoverage[]): SeasonCoverage {
  const open = rows.filter((row) => row.status === 'open');
  // Distinct lines: two deliverables owning `גנרטור וחשמל` are one budget,
  // not two.
  const lines = new Map<string, number>();
  for (const row of rows) {
    if (row.budgetLineId && row.budgetLineTotalAgorot !== null) {
      lines.set(row.budgetLineId, row.budgetLineTotalAgorot);
    }
  }
  return {
    tasks: rows.length,
    openTasks: open.length,
    uncoveredTasks: open.filter((row) => row.uncovered).length,
    placesNeeded: open.reduce((sum, row) => sum + row.peopleNeeded, 0),
    // Capped per task: six people on a task needing three is a full task,
    // not three spare places in the season. Uncapped, `16 מתוך 32` could
    // read `34 מתוך 32`.
    placesFilled: open.reduce(
      (sum, row) => sum + Math.min(row.accepted, row.peopleNeeded), 0,
    ),
    datelessTasks: open.filter((row) => taskWhen(row).kind === 'none').length,
    linkedBudgetAgorot: [...lines.values()].reduce((sum, total) => sum + total, 0),
  };
}

/** For callers that want the figures and not the rows — the home screen's
 *  coverage tile and the sidebar count. */
export async function seasonCoverageTotals(
  db: AnyDb, seasonId: string,
): Promise<SeasonCoverage> {
  return summarize(await coverageFor(db, seasonId));
}
