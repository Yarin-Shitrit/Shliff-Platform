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
  assignees: Assignee[];
}

export interface Responsibility {
  taskId: string;
  title: string;
  kind: TaskKind;
  seasonName: string;
  eventName: string | null;
  budgetAgorot: number | null;
  status: AssignmentStatus;
}

export async function assignPerson(
  db: AnyDb, taskId: string, personId: string, email: string,
  status: AssignmentStatus = 'proposed',
): Promise<string> {
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
    })
    .from(tasks)
    .leftJoin(campEvents, eq(campEvents.id, tasks.eventId))
    .where(eq(tasks.seasonId, seasonId))
    .orderBy(asc(tasks.kind), asc(tasks.title));

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

  return taskRows.map((task) => {
    const assignees = byTask.get(task.taskId) ?? [];
    const accepted = assignees
      .filter((a) => COUNTS_AS_COVERED.includes(a.status)).length;
    return {
      ...task,
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
    .orderBy(asc(seasons.year), asc(tasks.title));

  return rows.map((row) => ({
    taskId: row.taskId,
    title: row.title,
    kind: row.kind,
    seasonName: row.seasonName,
    eventName: row.eventName,
    budgetAgorot: row.budgetAmount === null ? null : toAgorot(row.budgetAmount),
    status: row.status,
  }));
}
