import { and, asc, eq, isNull } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { memberships, persons } from '@/db/schema/camp';
import { workItemPeople, workItems } from '@/db/schema/logistics';
import type { PlanItem, RosterOption, Topic } from './plan';

/**
 * ימי עבודה — who works on what, on each of the season's work days.
 *
 * A work day is an occasion of kind ״יום עבודה״ on לוח הנוכחות. Its tasks
 * are the plan's items whose days include it — nothing links the two rows,
 * the task says a day and the occasion is on that day. The crew of a task is
 * `work_item_people`: the people who will be doing it, beside the one
 * person responsible for it.
 *
 * This is a plan and לוח הנוכחות is a record: putting someone on a task
 * does not mark them present, and marking them present puts them on no
 * task. Nothing here moves a person or a day on its own — somebody on two
 * tasks of one day is reported, never resolved.
 *
 * English throws, on purpose (R9): the Hebrew is mapped at the action
 * boundary by the screen's `failure-messages.ts`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CrewRow {
  itemId: string;
  personId: string;
  /** Carried so the screen can name a person who has since left the roster. */
  displayName: string;
  addedBy: string;
}

/** Every crew row of the season's items, by name. */
export async function listCrew(db: AnyDb, seasonId: string): Promise<CrewRow[]> {
  return db
    .select({
      itemId: workItemPeople.workItemId,
      personId: workItemPeople.personId,
      displayName: persons.displayName,
      addedBy: workItemPeople.addedBy,
    })
    .from(workItemPeople)
    .innerJoin(workItems, eq(workItems.id, workItemPeople.workItemId))
    .innerJoin(persons, eq(persons.id, workItemPeople.personId))
    .where(eq(workItems.seasonId, seasonId))
    .orderBy(asc(persons.displayName));
}

/**
 * Puts one person on one task, or takes them off. Idempotent both ways: two
 * leads on two phones will tick the same box.
 *
 * Adding refuses a cancelled task and a person who is not on the season's
 * roster — the same refusal לוח הנוכחות makes, for the same reason: a name
 * the roster does not show is a decision for אנשים. Taking off refuses
 * neither, so someone who has left the roster can still be removed.
 */
export async function setCrewMember(
  db: AnyDb, itemId: string, personId: string, on: boolean, actor: string,
): Promise<void> {
  if (!UUID.test(itemId)) throw new Error(`unknown work item ${itemId}`);
  if (!UUID.test(personId)) throw new Error(`unknown person ${personId}`);
  const [item] = await db
    .select({ id: workItems.id, seasonId: workItems.seasonId, status: workItems.status })
    .from(workItems).where(eq(workItems.id, itemId));
  if (!item) throw new Error(`unknown work item ${itemId}`);

  if (!on) {
    await db.delete(workItemPeople)
      .where(and(eq(workItemPeople.workItemId, itemId), eq(workItemPeople.personId, personId)));
    return;
  }

  if (item.status === 'cancelled') throw new Error('that work item was cancelled');
  const [member] = await db
    .select({ personId: persons.id })
    .from(memberships)
    .innerJoin(persons, eq(persons.id, memberships.personId))
    .where(and(
      eq(memberships.seasonId, item.seasonId),
      eq(memberships.personId, personId),
      isNull(persons.mergedIntoId),
    ));
  if (!member) throw new Error('that person is not on this season roster');

  await db.insert(workItemPeople)
    .values({ workItemId: itemId, personId, addedBy: actor })
    .onConflictDoNothing({ target: [workItemPeople.workItemId, workItemPeople.personId] });
}

// ── The day ─────────────────────────────────────────────────────────────

/** A work day as this screen needs it: the occasion's id, its words, its day. */
export interface WorkDay {
  id: string;
  label: string;
  /** `YYYY-MM-DD`. */
  heldOn: string;
}

/** The items a day holds: not cancelled, and the day is inside their days. */
export function tasksOn<T extends Pick<PlanItem, 'status' | 'startsOn' | 'endsOn'>>(
  items: readonly T[], day: string,
): T[] {
  return items.filter((item) => item.status !== 'cancelled'
    && item.startsOn !== null
    && item.startsOn <= day
    && (item.endsOn ?? item.startsOn) >= day);
}

/**
 * Which day the screen opens on when the URL names none, or names one that
 * is not there: the next work day from today, else the last one there was.
 * A place to start reading, not a decision — every day is one press away.
 */
export function pickDay(days: readonly WorkDay[], wanted: string | null, today: string): WorkDay | null {
  const named = wanted === null ? undefined : days.find((day) => day.id === wanted);
  if (named) return named;
  const sorted = [...days].sort((a, b) => a.heldOn.localeCompare(b.heldOn));
  return sorted.find((day) => day.heldOn >= today) ?? sorted[sorted.length - 1] ?? null;
}

export interface CrewPerson {
  personId: string;
  displayName: string;
  /** False for someone on the task who is no longer on the season's roster. */
  onRoster: boolean;
  /** The other tasks of this day they are on, by title. Empty for most. */
  alsoOn: string[];
}

export interface DayTask {
  item: PlanItem;
  topicName: string | null;
  /** For a part: the general item it belongs to. */
  parentTitle: string | null;
  crew: CrewPerson[];
}

export interface DayView {
  tasks: DayTask[];
  /** Distinct people on at least one of the day's tasks. */
  assigned: number;
  /** Roster members on none of the day's tasks, by name. */
  free: RosterOption[];
  /** People on more than one of the day's tasks, with the titles. */
  doubled: Array<{ personId: string; displayName: string; titles: string[] }>;
}

/** Pure: one day's tasks, each with its crew, and who is left over. */
export function buildDay(
  day: string,
  items: readonly PlanItem[],
  topics: readonly Topic[],
  crew: readonly CrewRow[],
  roster: readonly RosterOption[],
): DayView {
  const todays = tasksOn(items, day);
  const titles = new Map(items.map((item) => [item.id, item.title]));
  const topicNames = new Map(topics.map((topic) => [topic.id, topic.name]));
  const onRoster = new Set(roster.map((person) => person.personId));
  const todayIds = new Set(todays.map((item) => item.id));

  const byItem = new Map<string, CrewRow[]>();
  const tasksOf = new Map<string, { displayName: string; itemIds: string[] }>();
  for (const row of crew) {
    if (!todayIds.has(row.itemId)) continue;
    byItem.set(row.itemId, [...(byItem.get(row.itemId) ?? []), row]);
    const entry = tasksOf.get(row.personId) ?? { displayName: row.displayName, itemIds: [] };
    entry.itemIds.push(row.itemId);
    tasksOf.set(row.personId, entry);
  }

  const tasks = todays.map((item): DayTask => ({
    item,
    topicName: item.topicId === null ? null : topicNames.get(item.topicId) ?? null,
    parentTitle: item.parentId === null ? null : titles.get(item.parentId) ?? null,
    crew: (byItem.get(item.id) ?? []).map((row) => ({
      personId: row.personId,
      displayName: row.displayName,
      onRoster: onRoster.has(row.personId),
      alsoOn: (tasksOf.get(row.personId)?.itemIds ?? [])
        .filter((id) => id !== item.id)
        .map((id) => titles.get(id) ?? ''),
    })),
  }));

  const doubled = [...tasksOf.entries()]
    .filter(([, entry]) => entry.itemIds.length > 1)
    .map(([personId, entry]) => ({
      personId,
      displayName: entry.displayName,
      titles: entry.itemIds.map((id) => titles.get(id) ?? ''),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'he'));

  return {
    tasks,
    assigned: tasksOf.size,
    free: roster.filter((person) => !tasksOf.has(person.personId)),
    doubled,
  };
}
