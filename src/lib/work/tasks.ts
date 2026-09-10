import { and, asc, eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { tasks, campEvents } from '@/db/schema/camp';
import type { TaskKind, TaskStatus } from '@/db/schema/camp';
import { toAgorot, fromAgorot } from '@/lib/money';
import { isBlank } from '@/lib/text/normalize';

export interface NewTask {
  seasonId: string;
  eventId?: string;
  kind: TaskKind;
  title: string;
  description?: string;
  /** deliverable: budget in shekels. */
  budgetAmount?: number;
  /** shift: both required. */
  startsAt?: Date;
  endsAt?: Date;
  /** build: optional deadline. */
  dueOn?: Date;
  peopleNeeded?: number;
}

export interface TaskRow {
  taskId: string;
  kind: TaskKind;
  title: string;
  description: string | null;
  budgetAgorot: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  dueOn: Date | null;
  peopleNeeded: number;
  status: TaskStatus;
  eventId: string | null;
  eventName: string | null;
}

/**
 * A shift with no window and an event task with no event are incoherent, and
 * accepting either would make the coverage report quietly wrong. Everything
 * else stays optional: the רחבה sheet has owned line items with no deadline.
 */
function validate(input: NewTask): void {
  // Blankness judged with normalizeHebrew, not `.trim()`, for the same reason
  // as the exception reason and the offset note: `.trim()` leaves LRM, RLM and
  // zero-width marks standing, and an RTL browser injects those invisibly on
  // copy-paste. A task titled with nothing but those would be invisible in the
  // coverage report while still counting toward it.
  if (isBlank(input.title)) throw new Error('a task needs a title');
  if (input.kind === 'shift') {
    if (!input.startsAt || !input.endsAt) {
      throw new Error('a shift needs a time window');
    }
    if (input.endsAt <= input.startsAt) {
      throw new Error('a shift may not end before it starts');
    }
  }
  if (input.kind === 'event_task' && !input.eventId) {
    throw new Error('an event task must name its event');
  }
  if (input.peopleNeeded !== undefined && input.peopleNeeded < 1) {
    throw new Error('a task needs at least one person');
  }
}

export async function createTask(db: AnyDb, input: NewTask): Promise<string> {
  validate(input);
  const [row] = await db.insert(tasks).values({
    seasonId: input.seasonId,
    eventId: input.eventId ?? null,
    kind: input.kind,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    budgetAmount: input.budgetAmount === undefined
      ? null
      : fromAgorot(toAgorot(input.budgetAmount)),
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    dueOn: input.dueOn ?? null,
    peopleNeeded: input.peopleNeeded ?? 1,
  }).returning();
  return row.id;
}

export async function listTasks(
  db: AnyDb, seasonId: string, filter?: { kind?: TaskKind },
): Promise<TaskRow[]> {
  const where = filter?.kind
    ? and(eq(tasks.seasonId, seasonId), eq(tasks.kind, filter.kind))
    : eq(tasks.seasonId, seasonId);

  const rows = await db
    .select({
      taskId: tasks.id,
      kind: tasks.kind,
      title: tasks.title,
      description: tasks.description,
      budgetAmount: tasks.budgetAmount,
      startsAt: tasks.startsAt,
      endsAt: tasks.endsAt,
      dueOn: tasks.dueOn,
      peopleNeeded: tasks.peopleNeeded,
      status: tasks.status,
      eventId: tasks.eventId,
      eventName: campEvents.name,
    })
    .from(tasks)
    .leftJoin(campEvents, eq(campEvents.id, tasks.eventId))
    .where(where)
    .orderBy(asc(tasks.kind), asc(tasks.title));

  return rows.map(({ budgetAmount, ...row }) => ({
    ...row,
    budgetAgorot: budgetAmount === null ? null : toAgorot(budgetAmount),
  }));
}

export async function setTaskStatus(
  db: AnyDb, taskId: string, status: TaskStatus,
): Promise<void> {
  await db.update(tasks).set({ status }).where(eq(tasks.id, taskId));
}
