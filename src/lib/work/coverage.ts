import { and, asc, eq, ne } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import {
  tasks, taskAssignments, persons, seasons, campEvents,
} from '@/db/schema/camp';
import type { AssignmentStatus, TaskKind, TaskStatus } from '@/db/schema/camp';
import { toAgorot } from '@/lib/money';

/** Only these count toward `peopleNeeded`. A `proposed` assignment is a lead's
 *  intention, not a commitment — counting it would report a shift as staffed
 *  when nobody has agreed to work it. */
const COUNTS_AS_COVERED: AssignmentStatus[] = ['accepted', 'done'];

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
      budgetAmount: tasks.budgetAmount,
      startsAt: tasks.startsAt,
      endsAt: tasks.endsAt,
      dueOn: tasks.dueOn,
    })
    .from(tasks)
    .leftJoin(campEvents, eq(campEvents.id, tasks.eventId))
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

  return taskRows.map(({ budgetAmount, ...task }) => {
    const assignees = byTask.get(task.taskId) ?? [];
    const accepted = assignees
      .filter((a) => COUNTS_AS_COVERED.includes(a.status)).length;
    return {
      ...task,
      budgetAgorot: budgetAmount === null ? null : toAgorot(budgetAmount),
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
