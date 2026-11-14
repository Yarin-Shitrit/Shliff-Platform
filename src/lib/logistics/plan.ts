import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { isBlank, normalizeHebrew } from '@/lib/text/normalize';
import { persons } from '@/db/schema/camp';
import {
  acquisitionItems, workDependencies, workItems, workTopics,
  type AcquisitionSource, type AcquisitionStatus, type WorkItemStatus,
} from '@/db/schema/logistics';
import { rosterWorkload } from '@/lib/work/coverage';
import { addDays, isCivilDay } from './shift-time';
import { PURCHASE_VERBS } from './labels';

/**
 * The logistics work plan: topics, the items under them, the smaller items
 * under those, and what has to finish before what.
 *
 * Everything here is one season's. A plan is the camp's answer to "what do
 * we build this year and in what order", and the answer changes every year.
 *
 * The dates are civil days (`YYYY-MM-DD`) and nothing here moves one. A
 * dependency the dates contradict is reported (`waitsFor[].conflict`) so the
 * screen can mark it, never resolved by shifting the later item — the camp
 * decides which date was wrong.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const WORK_ITEM_STATUSES: readonly WorkItemStatus[] = ['open', 'done', 'cancelled'];

// ── Topics ─────────────────────────────────────────────────────────────

export interface TopicInput {
  name: string;
  notes: string | null;
}

export interface Topic {
  id: string;
  seasonId: string;
  name: string;
  position: number;
  notes: string | null;
  archivedAt: Date | null;
  updatedAt: Date;
  updatedBy: string | null;
}

function cleanNotes(notes: string | null | undefined): string | null {
  return notes && !isBlank(notes) ? notes.trim() : null;
}

/**
 * Two active topics with one name are two headings that read the same, and
 * items would be filed under whichever a lead happened to pick. Compared
 * normalised; an archived topic does not hold its name.
 */
async function refuseDuplicateTopic(
  db: AnyDb, seasonId: string, name: string, exceptId: string | null,
): Promise<void> {
  const wanted = normalizeHebrew(name);
  const active = await db.select({ id: workTopics.id, name: workTopics.name })
    .from(workTopics)
    .where(and(eq(workTopics.seasonId, seasonId), isNull(workTopics.archivedAt)));
  if (active.some((row) => row.id !== exceptId && normalizeHebrew(row.name) === wanted)) {
    throw new Error('a topic with that name already exists');
  }
}

export async function createTopic(
  db: AnyDb, seasonId: string, input: TopicInput, email: string,
): Promise<string> {
  if (isBlank(input.name)) throw new Error('a topic needs a name');
  if (!UUID.test(seasonId)) throw new Error(`unknown season ${seasonId}`);
  await refuseDuplicateTopic(db, seasonId, input.name, null);
  const existing = await db.select({ position: workTopics.position })
    .from(workTopics).where(eq(workTopics.seasonId, seasonId));
  const position = existing.reduce((max, row) => Math.max(max, row.position + 1), 0);
  const [row] = await db.insert(workTopics).values({
    seasonId,
    name: input.name.trim(),
    position,
    notes: cleanNotes(input.notes),
    updatedBy: email,
  }).returning();
  return row.id;
}

export async function updateTopic(
  db: AnyDb, id: string, input: TopicInput, email: string,
): Promise<void> {
  if (isBlank(input.name)) throw new Error('a topic needs a name');
  const topic = await topicById(db, id);
  if (!topic) throw new Error(`unknown topic ${id}`);
  await refuseDuplicateTopic(db, topic.seasonId, input.name, id);
  await db.update(workTopics).set({
    name: input.name.trim(),
    notes: cleanNotes(input.notes),
    updatedAt: new Date(),
    updatedBy: email,
  }).where(eq(workTopics.id, id));
}

/** Archives or restores. Nothing is deleted; the items keep their topic. */
export async function setTopicArchived(
  db: AnyDb, id: string, archived: boolean, email: string,
): Promise<void> {
  const topic = await topicById(db, id);
  if (!topic) throw new Error(`unknown topic ${id}`);
  if (!archived) await refuseDuplicateTopic(db, topic.seasonId, topic.name, id);
  await db.update(workTopics).set({
    archivedAt: archived ? new Date() : null,
    updatedAt: new Date(),
    updatedBy: email,
  }).where(eq(workTopics.id, id));
}

export async function topicById(db: AnyDb, id: string): Promise<Topic | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(workTopics).where(eq(workTopics.id, id));
  return row ?? null;
}

/** Active topics in the lead's order, then the archived ones. */
export async function listTopics(db: AnyDb, seasonId: string): Promise<Topic[]> {
  const rows = await db.select().from(workTopics)
    .where(eq(workTopics.seasonId, seasonId))
    .orderBy(asc(workTopics.position), asc(workTopics.name));
  return [...rows].sort((a, b) =>
    Number(a.archivedAt !== null) - Number(b.archivedAt !== null)
    || a.position - b.position
    || a.name.localeCompare(b.name, 'he'));
}

// ── Items ──────────────────────────────────────────────────────────────

export interface ItemInput {
  title: string;
  notes: string | null;
  /** Null means no topic — listed under ״בלי נושא״. */
  topicId: string | null;
  /** Null means a general item; an id makes this a sub-item of it. */
  parentId: string | null;
  startsOn: string | null;
  endsOn: string | null;
  assigneePersonId: string | null;
}

export interface Schedule {
  startsOn: string | null;
  endsOn: string | null;
}

/**
 * What a pair of dates means, checked once for every write. A blank end with
 * a start is the one day; an end with no start is a question nobody can
 * answer, and so is an end before the start.
 */
export function validateSchedule(input: Schedule): Schedule {
  const startsOn = input.startsOn?.trim() || null;
  const endsOn = input.endsOn?.trim() || null;
  if (startsOn !== null && !isCivilDay(startsOn)) throw new Error('a work item needs a real start day');
  if (endsOn !== null && !isCivilDay(endsOn)) throw new Error('a work item needs a real end day');
  if (endsOn !== null && startsOn === null) throw new Error('a work item cannot end before it starts');
  if (endsOn !== null && startsOn !== null && endsOn < startsOn) {
    throw new Error('a work item cannot end before it starts');
  }
  return { startsOn, endsOn };
}

type ItemRow = typeof workItems.$inferSelect;

async function itemRow(db: AnyDb, id: string): Promise<ItemRow | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(workItems).where(eq(workItems.id, id));
  return row ?? null;
}

async function hasChildren(db: AnyDb, id: string): Promise<boolean> {
  const rows = await db.select({ id: workItems.id }).from(workItems).where(eq(workItems.parentId, id));
  return rows.length > 0;
}

/**
 * The checks every write of an item shares. A parent has to be a general
 * item of the same season — two levels and no more, because a third level
 * is a plan nobody can read on one screen — and a topic has to be the
 * season's. A sub-item takes its parent's topic rather than one of its own,
 * so a parent and its parts cannot sit under two headings.
 */
async function resolveItemInput(
  db: AnyDb, seasonId: string, input: ItemInput, selfId: string | null,
): Promise<{
  title: string; notes: string | null; topicId: string | null; parentId: string | null;
  startsOn: string | null; endsOn: string | null; assigneePersonId: string | null;
}> {
  if (isBlank(input.title)) throw new Error('a work item needs a title');
  const { startsOn, endsOn } = validateSchedule(input);

  let parentId: string | null = null;
  let topicId: string | null = null;
  if (input.parentId !== null && input.parentId !== '') {
    if (selfId !== null && input.parentId === selfId) throw new Error('a work item cannot be its own parent');
    const parent = await itemRow(db, input.parentId);
    if (!parent || parent.seasonId !== seasonId) throw new Error(`unknown work item ${input.parentId}`);
    if (parent.parentId !== null) throw new Error('a sub-item cannot have sub-items of its own');
    if (selfId !== null && await hasChildren(db, selfId)) {
      throw new Error('a sub-item cannot have sub-items of its own');
    }
    parentId = parent.id;
    topicId = parent.topicId;
  } else if (input.topicId !== null && input.topicId !== '') {
    const topic = await topicById(db, input.topicId);
    if (!topic || topic.seasonId !== seasonId) throw new Error(`unknown topic ${input.topicId}`);
    topicId = topic.id;
  }

  let assigneePersonId: string | null = null;
  if (input.assigneePersonId !== null && input.assigneePersonId !== '') {
    if (!UUID.test(input.assigneePersonId)) throw new Error(`unknown person ${input.assigneePersonId}`);
    const [person] = await db.select({ id: persons.id }).from(persons)
      .where(eq(persons.id, input.assigneePersonId));
    if (!person) throw new Error(`unknown person ${input.assigneePersonId}`);
    assigneePersonId = person.id;
  }

  return {
    title: input.title.trim(), notes: cleanNotes(input.notes), topicId, parentId,
    startsOn, endsOn, assigneePersonId,
  };
}

export async function createItem(
  db: AnyDb, seasonId: string, input: ItemInput, email: string,
): Promise<string> {
  if (!UUID.test(seasonId)) throw new Error(`unknown season ${seasonId}`);
  const resolved = await resolveItemInput(db, seasonId, input, null);
  const siblings = await db.select({ position: workItems.position }).from(workItems)
    .where(and(
      eq(workItems.seasonId, seasonId),
      resolved.parentId === null ? isNull(workItems.parentId) : eq(workItems.parentId, resolved.parentId),
    ));
  const position = siblings.reduce((max, row) => Math.max(max, row.position + 1), 0);
  const [row] = await db.insert(workItems).values({
    seasonId, ...resolved, position, updatedBy: email,
  }).returning();
  return row.id;
}

/**
 * A purchase's line takes its title and its person from the purchase (see
 * `followPurchase` in `acquisitions.ts`), and the drawer locks both. The
 * lock is repeated here because a drawer opened before the list changed
 * still sends what it was opened with: saving a day from it would write
 * the old name and the old person back over the purchase's. For a linked
 * item the two are not validated and not written — whatever was sent —
 * and everything the board owns (days, topic, parent, notes) still saves.
 */
export async function updateItem(
  db: AnyDb, id: string, input: ItemInput, email: string,
): Promise<void> {
  const item = await itemRow(db, id);
  if (!item) throw new Error(`unknown work item ${id}`);
  const linked = item.acquisitionItemId !== null;
  const resolved = await resolveItemInput(
    db, item.seasonId,
    linked ? { ...input, title: item.title, assigneePersonId: item.assigneePersonId } : input,
    id,
  );
  const { title, assigneePersonId, ...boardOwned } = resolved;
  await db.update(workItems)
    .set({ ...(linked ? boardOwned : { ...boardOwned, title, assigneePersonId }), updatedAt: new Date(), updatedBy: email })
    .where(eq(workItems.id, id));
  /* A parent's sub-items follow it between topics: they never had a heading
     of their own. */
  if (item.topicId !== resolved.topicId) {
    await db.update(workItems).set({ topicId: resolved.topicId })
      .where(eq(workItems.parentId, id));
  }
}

/** The quick verb from the timeline: only the days change. */
export async function scheduleItem(
  db: AnyDb, id: string, schedule: Schedule, email: string,
): Promise<void> {
  if (!(await itemRow(db, id))) throw new Error(`unknown work item ${id}`);
  const { startsOn, endsOn } = validateSchedule(schedule);
  await db.update(workItems).set({ startsOn, endsOn, updatedAt: new Date(), updatedBy: email })
    .where(eq(workItems.id, id));
}

/**
 * A purchase's item is done when the thing arrives, and that is said on
 * רכש, not here: `done` is refused with the pointer, and `open` lands on
 * whatever the purchase says — open, or done if it has arrived in the
 * meantime. `cancelled` stays the board's own decision: the camp can stop
 * wanting a thing, and the list has no word for that.
 */
export async function setItemStatus(
  db: AnyDb, id: string, status: WorkItemStatus, email: string,
): Promise<void> {
  if (!WORK_ITEM_STATUSES.includes(status)) throw new Error(`unknown work item status: ${status}`);
  const item = await itemRow(db, id);
  if (!item) throw new Error(`unknown work item ${id}`);
  let next = status;
  if (item.acquisitionItemId !== null && status !== 'cancelled') {
    if (status === 'done') throw new Error('a purchase item is done when its purchase arrives');
    const [purchase] = await db.select({ status: acquisitionItems.status }).from(acquisitionItems)
      .where(eq(acquisitionItems.id, item.acquisitionItemId));
    next = purchase?.status === 'arrived' ? 'done' : 'open';
  }
  await db.update(workItems).set({ status: next, updatedAt: new Date(), updatedBy: email })
    .where(eq(workItems.id, id));
}

// ── Purchases ──────────────────────────────────────────────────────────

/**
 * The title a purchase's line on the board carries: the verb for the way
 * of getting it, the name, and the count when it is more than one —
 * ״לקנות כיסא (12)״. Built here and nowhere else, so the list and the
 * board cannot drift into two spellings of one thing.
 */
export function purchaseTitle(source: AcquisitionSource, name: string, quantity: number): string {
  const base = `${PURCHASE_VERBS[source]} ${name.trim()}`;
  return quantity > 1 ? `${base} (${quantity})` : base;
}

/** The first words a lead writes when an item is a thing to buy. */
const PURCHASE_OPENING = /^(?:לקנות|לרכוש|קניית|רכישת)\s+\S/;

/**
 * Every opening the list's own vocabulary knows, and the way of getting
 * the thing each one says: the buying words a lead writes, and the two
 * verbs `purchaseTitle` itself writes for the other sources.
 */
const VERB_SOURCES: ReadonlyArray<readonly [string, AcquisitionSource]> = [
  ['לקנות', 'buy_new'], ['לרכוש', 'buy_new'], ['קניית', 'buy_new'], ['רכישת', 'buy_new'],
  [PURCHASE_VERBS.second_hand, 'second_hand'],
  [PURCHASE_VERBS.borrow_member, 'borrow_member'],
];
/** Whitespace and the invisible marks a browser adds around pasted Hebrew. */
const EDGES = /^[\s\u00a0\u200b\u200d\u200e\u200f]+|[\s\u00a0\u200b\u200d\u200e\u200f]+$/g;

/** Whether an item's title reads as buying something: a buying verb, then a thing. */
export function looksLikePurchase(title: string): boolean {
  return PURCHASE_OPENING.test(normalizeHebrew(title));
}

export interface PurchaseReading {
  /** The way of getting it the title's own first word says; buying when it says none. */
  source: AcquisitionSource;
  /** The thing itself, in the lead's spelling. */
  name: string;
}

/**
 * What a board title says about a purchase: ״לקנות מכולה״ is buying a
 * ״מכולה״, ״להשיג מקרר״ is a second-hand ״מקרר״. The verb is read, never
 * added to: a title that already opens with one of the list's verbs keeps
 * it, so the board's line is not rewritten into ״לקנות להשיג מקרר״.
 *
 * The name is cut out of the title as it was typed. Nothing here is
 * normalised — `normalizeHebrew` is for comparing, and storing its output
 * turned the geresh of ״צ׳ילר״ into an apostrophe no lead wrote.
 *
 * A title with no verb is kept whole and read as buying — the lead ticked
 * it as a purchase, and the drawer says how it will go in. A title that is
 * only the verb is kept too: a row with no name is a refusal, not a row.
 */
export function readPurchase(title: string): PurchaseReading {
  const whole = title.replace(EDGES, '');
  for (const [verb, source] of VERB_SOURCES) {
    if (!whole.startsWith(verb)) continue;
    const rest = whole.slice(verb.length);
    if (!/^[\s\u00a0]/.test(rest)) continue;
    const name = rest.replace(EDGES, '');
    if (name !== '') return { source, name };
  }
  return { source: 'buy_new', name: whole };
}

/** The thing itself, for the row's name: ״לקנות מכולה״ → ״מכולה״. */
export function purchaseNameOf(title: string): string {
  return readPurchase(title).name;
}

/**
 * What moving one board item to the acquisitions list will do, worked out
 * before the button is pressed and again, from the database, when it is.
 */
export interface AdoptOutcome extends PurchaseReading {
  /** A row of the same name already in the list with no line on the board:
   *  the item is linked to it, and no second row is written. `assignee` is
   *  the row's own person, who stays on both — the drawer says so when the
   *  item names somebody else. */
  existing: { id: string; name: string; assignee: { id: string; name: string } | null } | null;
  /** The board's title after the move. */
  boardTitle: string;
  /**
   * Why this item cannot move from here. `needs_lender`: a borrowed thing
   * has to name who lends it, and the board does not know. `ambiguous`:
   * more than one row carries the name, and the system does not pick.
   */
  refusal: 'needs_lender' | 'ambiguous' | null;
}

export interface AdoptableItem {
  id: string;
  title: string;
  /** True when the title opens with a buying verb — ticked by default. */
  suggested: boolean;
  assignee: { personId: string; displayName: string } | null;
  parentId: string | null;
  /** What the move will do with it; the page fills it in for the drawer. */
  outcome?: AdoptOutcome;
}

/**
 * The open items not yet in the acquisitions list, for the drawer that
 * moves them there: the ones that read as buying first and suggested, the
 * rest after and left for the lead to tick. Done and cancelled items are
 * history and are not offered.
 */
export function adoptableItems(items: PlanItem[]): AdoptableItem[] {
  return items
    .filter((item) => item.status === 'open' && item.purchase === null)
    .map((item) => ({
      id: item.id, title: item.title, suggested: looksLikePurchase(item.title),
      assignee: item.assignee, parentId: item.parentId,
    }))
    .sort((a, b) => Number(b.suggested) - Number(a.suggested));
}

// ── Dependencies ───────────────────────────────────────────────────────

/**
 * Records that `beforeId` has to be finished before `afterId` starts.
 *
 * Refused: the same item on both sides, items of two seasons, and a pair
 * that would close a cycle. The cycle check walks what `afterId` already
 * blocks — if `beforeId` is reachable from it, the new edge would make a
 * ring, and a ring is a plan with no first step.
 */
export async function addDependency(db: AnyDb, beforeId: string, afterId: string): Promise<string> {
  if (beforeId === afterId) throw new Error('a work item cannot wait for itself');
  const before = await itemRow(db, beforeId);
  const after = await itemRow(db, afterId);
  if (!before) throw new Error(`unknown work item ${beforeId}`);
  if (!after) throw new Error(`unknown work item ${afterId}`);
  if (before.seasonId !== after.seasonId) throw new Error('a dependency cannot cross seasons');

  const edges = await db.select({ beforeId: workDependencies.beforeId, afterId: workDependencies.afterId })
    .from(workDependencies);
  if (edges.some((edge) => edge.beforeId === beforeId && edge.afterId === afterId)) {
    throw new Error('that dependency already exists');
  }
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const list = next.get(edge.beforeId) ?? [];
    list.push(edge.afterId);
    next.set(edge.beforeId, list);
  }
  const seen = new Set<string>();
  const stack = [afterId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === beforeId) throw new Error('that dependency would make a cycle');
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(next.get(current) ?? []));
  }

  const [row] = await db.insert(workDependencies).values({ beforeId, afterId }).returning();
  return row.id;
}

export async function removeDependency(db: AnyDb, id: string): Promise<void> {
  if (!UUID.test(id)) throw new Error(`unknown dependency ${id}`);
  const [row] = await db.select({ id: workDependencies.id }).from(workDependencies)
    .where(eq(workDependencies.id, id));
  if (!row) throw new Error(`unknown dependency ${id}`);
  await db.delete(workDependencies).where(eq(workDependencies.id, id));
}

// ── Reading the plan ───────────────────────────────────────────────────

export interface DependencyRef {
  dependencyId: string;
  itemId: string;
  title: string;
  status: WorkItemStatus;
  startsOn: string | null;
  endsOn: string | null;
  /**
   * True when both sides are scheduled and the earlier one is not over
   * before the later one starts. Reported, never fixed: the camp picks
   * which date was wrong.
   */
  conflict: boolean;
}

export interface PurchaseRef {
  /** The acquisition row; the board links to its drawer on רכש. */
  id: string;
  status: AcquisitionStatus;
}

export interface PlanItem {
  id: string;
  seasonId: string;
  topicId: string | null;
  parentId: string | null;
  title: string;
  notes: string | null;
  startsOn: string | null;
  endsOn: string | null;
  status: WorkItemStatus;
  position: number;
  assignee: { personId: string; displayName: string } | null;
  /** The purchase this item is the buying of, or null for an item of the board's own. */
  purchase: PurchaseRef | null;
  /** What this item has to wait for. */
  waitsFor: DependencyRef[];
  /** What waits for this item. */
  blocks: DependencyRef[];
  updatedAt: Date;
  updatedBy: string | null;
}

/** The last day an item occupies: its end, or its start when it has none. */
export function lastDayOf(item: Pick<PlanItem, 'startsOn' | 'endsOn'>): string | null {
  return item.endsOn ?? item.startsOn;
}

/**
 * Whether ״before לפני after״ is contradicted by the dates. Only answerable
 * when both are scheduled; an unscheduled side is not a conflict, it is a
 * gap the list already shows.
 */
export function datesConflict(
  before: Pick<PlanItem, 'startsOn' | 'endsOn'>, after: Pick<PlanItem, 'startsOn' | 'endsOn'>,
): boolean {
  const last = lastDayOf(before);
  if (last === null || after.startsOn === null) return false;
  return last >= after.startsOn;
}

/** Every item of the season, with its assignee and both sides of its dependencies. */
export async function listPlan(db: AnyDb, seasonId: string): Promise<PlanItem[]> {
  const rows = await db.select({
    item: workItems,
    assigneeName: persons.displayName,
    purchaseStatus: acquisitionItems.status,
  })
    .from(workItems)
    .leftJoin(persons, eq(persons.id, workItems.assigneePersonId))
    .leftJoin(acquisitionItems, eq(acquisitionItems.id, workItems.acquisitionItemId))
    .where(eq(workItems.seasonId, seasonId))
    .orderBy(asc(workItems.position), asc(workItems.createdAt));
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.item.id);
  const edges = await db.select().from(workDependencies)
    .where(or(inArray(workDependencies.beforeId, ids), inArray(workDependencies.afterId, ids)));

  const byId = new Map(rows.map((row) => [row.item.id, row.item]));
  const items: PlanItem[] = rows.map(({ item, assigneeName, purchaseStatus }) => ({
    id: item.id,
    seasonId: item.seasonId,
    topicId: item.topicId,
    parentId: item.parentId,
    title: item.title,
    notes: item.notes,
    startsOn: item.startsOn,
    endsOn: item.endsOn,
    status: item.status,
    position: item.position,
    assignee: item.assigneePersonId !== null && assigneeName !== null
      ? { personId: item.assigneePersonId, displayName: assigneeName }
      : null,
    purchase: item.acquisitionItemId !== null && purchaseStatus !== null
      ? { id: item.acquisitionItemId, status: purchaseStatus }
      : null,
    waitsFor: [],
    blocks: [],
    updatedAt: item.updatedAt,
    updatedBy: item.updatedBy,
  }));
  const planById = new Map(items.map((item) => [item.id, item]));

  for (const edge of edges) {
    const before = byId.get(edge.beforeId);
    const after = byId.get(edge.afterId);
    if (!before || !after) continue;
    const conflict = datesConflict(before, after);
    planById.get(after.id)!.waitsFor.push({
      dependencyId: edge.id, itemId: before.id, title: before.title, status: before.status,
      startsOn: before.startsOn, endsOn: before.endsOn, conflict,
    });
    planById.get(before.id)!.blocks.push({
      dependencyId: edge.id, itemId: after.id, title: after.title, status: after.status,
      startsOn: after.startsOn, endsOn: after.endsOn, conflict,
    });
  }
  for (const item of items) {
    item.waitsFor.sort((a, b) => a.title.localeCompare(b.title, 'he'));
    item.blocks.sort((a, b) => a.title.localeCompare(b.title, 'he'));
  }
  return items;
}

export async function planItemById(db: AnyDb, id: string): Promise<PlanItem | null> {
  const row = await itemRow(db, id);
  if (!row) return null;
  const items = await listPlan(db, row.seasonId);
  return items.find((item) => item.id === id) ?? null;
}

// ── Shapes for the screen (pure) ───────────────────────────────────────

export interface PlanBranch {
  item: PlanItem;
  children: PlanItem[];
}

export interface PlanGroup {
  /** Null is the group for items under no topic. */
  topic: Topic | null;
  /** The topic's colour slot, `1`–`TOPIC_HUES`; null for no topic. See `topicHue`. */
  hue: number | null;
  branches: PlanBranch[];
}

/**
 * How many colours a topic can wear. Six, in a fixed order, assigned by
 * the topic's place in the lead's order — never by name, never hashed —
 * so the first six topics are always told apart and a seventh shares the
 * first's colour rather than inventing one. The colour is never the only
 * thing that says which topic a bar belongs to: the lane and the heading
 * carry the name (R3).
 */
export const TOPIC_HUES = 6;

/**
 * The colour slot of a topic: its place among the season's topics by the
 * lead's own order (position, then name), wrapped into `TOPIC_HUES`.
 *
 * Archived topics are counted where they stand. `listTopics` hands them
 * over last, and taking the index in that list meant archiving ״מטבח״
 * repainted every topic after it — the colour a lead had learned for
 * ״סלון״ became another topic's overnight. Null for an item under no
 * topic, and for a topic the list does not know.
 */
export function topicHue(
  topics: readonly Pick<Topic, 'id' | 'position' | 'name'>[], topicId: string | null,
): number | null {
  if (topicId === null) return null;
  const inOrder = [...topics].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'he'));
  const index = inOrder.findIndex((topic) => topic.id === topicId);
  return index === -1 ? null : (index % TOPIC_HUES) + 1;
}

function byOrder(a: PlanItem, b: PlanItem): number {
  return a.position - b.position || a.title.localeCompare(b.title, 'he');
}

/**
 * The plan as the list reads it: a group per topic in the lead's order,
 * general items under each, sub-items under those. An active topic with
 * nothing in it still gets a group — the empty heading is the invitation.
 * An archived topic appears only while it still holds items, and the
 * no-topic group only when something is in it, last.
 */
export function buildPlanTree(items: PlanItem[], topics: Topic[]): PlanGroup[] {
  const children = new Map<string, PlanItem[]>();
  const roots: PlanItem[] = [];
  for (const item of items) {
    if (item.parentId === null) { roots.push(item); continue; }
    const list = children.get(item.parentId) ?? [];
    list.push(item);
    children.set(item.parentId, list);
  }
  roots.sort(byOrder);
  for (const list of children.values()) list.sort(byOrder);

  /* A sub-item whose parent is not in the season's rows (cannot happen with
     the cascade, but a plan that silently dropped a row would be worse than
     one that showed it at the top). */
  const known = new Set(items.map((item) => item.id));
  for (const [parentId, list] of children) {
    if (!known.has(parentId)) roots.push(...list);
  }

  const groups = new Map<string | null, PlanGroup>();
  for (const topic of topics) {
    if (topic.archivedAt === null) groups.set(topic.id, { topic, hue: topicHue(topics, topic.id), branches: [] });
  }
  for (const root of roots) {
    let group = groups.get(root.topicId);
    if (!group) {
      const topic = root.topicId === null ? null : topics.find((t) => t.id === root.topicId) ?? null;
      group = { topic, hue: topicHue(topics, topic?.id ?? null), branches: [] };
      groups.set(root.topicId, group);
    }
    group.branches.push({ item: root, children: children.get(root.id) ?? [] });
  }

  return [...groups.values()].sort((a, b) => {
    if (a.topic === null) return 1;
    if (b.topic === null) return -1;
    return Number(a.topic.archivedAt !== null) - Number(b.topic.archivedAt !== null)
      || a.topic.position - b.topic.position
      || a.topic.name.localeCompare(b.topic.name, 'he');
  });
}

export interface TimelineDay {
  day: string;
  /** 0-based column. */
  index: number;
  /** `1`–`31`, for the header. */
  dayOfMonth: number;
  /** `0` is Sunday. */
  weekday: number;
  /** True on the first day of a month, where the header writes the month. */
  monthStart: boolean;
}

export interface TimelineBar {
  item: PlanItem;
  /** 0-based column of the first day. */
  start: number;
  /** Columns the bar spans, at least 1. */
  span: number;
  /** For a part: the title of the item it belongs to, so the bar can say so. */
  parentTitle?: string;
  /**
   * For a general item with parts: how many it has in all — the number the
   * list writes beside it, undated and cancelled parts included. The lanes
   * hold only some of those as bars, so the bar says both.
   */
  parts?: number;
}

export interface TimelineLane {
  topic: Topic | null;
  /** The topic's colour slot; see `topicHue`. */
  hue: number | null;
  bars: TimelineBar[];
}

export interface Timeline {
  days: TimelineDay[];
  lanes: TimelineLane[];
  /** Scheduled, cancelled items are left off the lanes; this is the count that was placed. */
  placed: number;
}

function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** `7` for `2026-05-07`, Sunday is `0`. */
function dayParts(day: string): { dayOfMonth: number; weekday: number } {
  const at = new Date(`${day}T00:00:00Z`);
  return { dayOfMonth: at.getUTCDate(), weekday: at.getUTCDay() };
}

/**
 * The scheduled items laid on days: the span runs from the earliest start
 * to the latest end among open and done items, padded to begin on a Sunday
 * and end on a Saturday, so the columns are the camp's whole weeks. It is
 * always the whole plan — the screen's resolution (a column a day, a week
 * or a month) changes how wide a day is drawn, not which days there are.
 *
 * Null when nothing in the season is scheduled — there is no timeline to
 * draw, and the screen says so instead of drawing an empty strip around
 * today.
 *
 * Cancelled items are left off: they are history, and the list still shows
 * them. A sub-item is a bar of its own on its parent's lane, carrying its
 * parent's title; a parent with no dates of its own is not drawn, since its
 * parts are.
 */
export function buildTimeline(items: PlanItem[], topics: Topic[]): Timeline | null {
  const scheduled = items.filter((item) => item.status !== 'cancelled' && item.startsOn !== null);
  if (scheduled.length === 0) return null;

  let from = scheduled[0].startsOn!;
  let to = lastDayOf(scheduled[0])!;
  for (const item of scheduled) {
    if (item.startsOn! < from) from = item.startsOn!;
    const last = lastDayOf(item)!;
    if (last > to) to = last;
  }
  from = addDays(from, -dayParts(from).weekday);
  to = addDays(to, 6 - dayParts(to).weekday);

  const days: TimelineDay[] = [];
  const total = dayDiff(from, to) + 1;
  for (let index = 0; index < total; index += 1) {
    const day = addDays(from, index);
    const parts = dayParts(day);
    days.push({ day, index, ...parts, monthStart: parts.dayOfMonth === 1 || index === 0 });
  }

  /* From every item, not only the scheduled: a part's parent may be
     undated, and the bar still says whose part it is. */
  const titles = new Map(items.map((item) => [item.id, item.title]));
  const partsOf = new Map<string, number>();
  for (const item of items) {
    if (item.parentId !== null) partsOf.set(item.parentId, (partsOf.get(item.parentId) ?? 0) + 1);
  }
  const groups = buildPlanTree(scheduled, topics);
  const lanes: TimelineLane[] = [];
  for (const group of groups) {
    const bars: TimelineBar[] = [];
    for (const branch of group.branches) {
      for (const item of [branch.item, ...branch.children]) {
        if (item.startsOn === null) continue;
        const bar: TimelineBar = {
          item, start: dayDiff(from, item.startsOn), span: dayDiff(item.startsOn, lastDayOf(item)!) + 1,
        };
        const parentTitle = item.parentId === null ? undefined : titles.get(item.parentId);
        if (parentTitle !== undefined) bar.parentTitle = parentTitle;
        const parts = partsOf.get(item.id);
        if (parts !== undefined) bar.parts = parts;
        bars.push(bar);
      }
    }
    if (bars.length > 0) lanes.push({ topic: group.topic, hue: group.hue, bars });
  }

  return { days, lanes, placed: scheduled.length };
}

export interface PlanTotals {
  open: number;
  done: number;
  scheduled: number;
  unscheduled: number;
  conflicts: number;
}

/** What the tiles say. Cancelled items count nowhere. */
export function summarizePlan(items: PlanItem[]): PlanTotals {
  const live = items.filter((item) => item.status !== 'cancelled');
  const open = live.filter((item) => item.status === 'open');
  return {
    open: open.length,
    done: live.length - open.length,
    scheduled: open.filter((item) => item.startsOn !== null).length,
    unscheduled: open.filter((item) => item.startsOn === null).length,
    conflicts: live.reduce((sum, item) => sum + item.waitsFor.filter((dep) => dep.conflict).length, 0),
  };
}

export interface RosterOption {
  personId: string;
  displayName: string;
}

/** Who may be made responsible: the season's roster, by name. */
export async function planRoster(db: AnyDb, seasonId: string): Promise<RosterOption[]> {
  const roster = await rosterWorkload(db, seasonId);
  return roster
    .map(({ personId, displayName }) => ({ personId, displayName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'he'));
}

// ── Now ────────────────────────────────────────────────────────────────

/** Open, scheduled, and its last day is behind the camp's today. */
export function isOverdue(item: Pick<PlanItem, 'status' | 'startsOn' | 'endsOn'>, today: string): boolean {
  const last = lastDayOf(item);
  return item.status === 'open' && last !== null && last < today;
}

/** Open and today falls inside its days. */
export function isUnderway(item: Pick<PlanItem, 'status' | 'startsOn' | 'endsOn'>, today: string): boolean {
  const last = lastDayOf(item);
  return item.status === 'open' && item.startsOn !== null && item.startsOn <= today && last! >= today;
}

export interface NowSummary {
  /** Open items whose days include today, earliest start first. */
  underway: PlanItem[];
  /** The next open item to start after today, or null. */
  next: PlanItem | null;
  /** Open items whose last day has passed. */
  overdue: PlanItem[];
}

/**
 * What the plan says about today: what is being worked on, what comes
 * next, what slipped. Cancelled and done items count nowhere; a part and
 * its parent can both be underway, which is true and reads fine.
 */
export function nowSummary(items: PlanItem[], today: string): NowSummary {
  const open = items.filter((item) => item.status === 'open' && item.startsOn !== null);
  const byStart = (a: PlanItem, b: PlanItem) => a.startsOn!.localeCompare(b.startsOn!) || byOrder(a, b);
  const underway = open.filter((item) => isUnderway(item, today)).sort(byStart);
  const upcoming = open.filter((item) => item.startsOn! > today).sort(byStart);
  const overdue = open.filter((item) => isOverdue(item, today)).sort(byStart);
  return { underway, next: upcoming[0] ?? null, overdue };
}
