import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import type { AnyDb } from '@/lib/db-types';
import { isBlank, normalizeHebrew } from '@/lib/text/normalize';
import { toAgorot, fromAgorot } from '@/lib/money';
import { persons } from '@/db/schema/camp';
import {
  acquisitionItems, workItems,
  type AcquisitionSource, type AcquisitionStatus, type LogisticsCategory,
  type ItemCondition,
} from '@/db/schema/logistics';
import { createItem, addToItem, itemById } from './warehouse';
import { createItem as createPlanItem, purchaseTitle, readPurchase, type AdoptOutcome } from './plan';
import { statusOf, type AcquisitionQuery } from './acquisitions-views';
import { rowEstimateAgorot } from './estimate';

/**
 * What the camp still needs for one season, and what happened to each of
 * those needs.
 *
 * The warehouse and this module disagree about seasons on purpose: gear
 * outlives a burn, a shopping list does not. They meet in one place —
 * `recordArrival`, below — and that meeting is a decision a lead makes, never
 * one this module infers.
 *
 * One exception to the season: a row with `seasonId === null` is camp-wide —
 * needed whichever burn is next — and is listed under every season. The
 * screen marks such rows, so a lead reading ברן 26's list knows which lines
 * were written for it and which came along because they always apply.
 */

export interface PersonRef { id: string; name: string }

export interface AcquisitionRow {
  id: string;
  /** Null is camp-wide: the row is not one season's and shows under all of them. */
  seasonId: string | null;
  name: string;
  category: LogisticsCategory;
  quantityNeeded: number;
  source: AcquisitionSource;
  /**
   * What one of them is expected to cost — the number a lead types, and what
   * `estimated_cost` stores. Null is "nobody has priced it", which is not the
   * same as free.
   */
  unitEstimateAgorot: number | null;
  /** The row's estimate: the unit price times `quantityNeeded`. Never typed. */
  estimatedAgorot: number | null;
  /**
   * What was paid in the end for all of them — the receipt, not a unit price,
   * so the count does not multiply it. Null is "not bought yet", which is not
   * the same as it having cost zero.
   */
  actualAgorot: number | null;
  assignee: PersonRef | null;
  lender: PersonRef | null;
  budgetLineId: string | null;
  arrivedItemId: string | null;
  /** The row's line on the work plan, when it has one, and whose board it is on. */
  workItem: { id: string; seasonId: string } | null;
  status: AcquisitionStatus;
  updatedAt: Date;
  updatedBy: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CATEGORIES: readonly LogisticsCategory[] = [
  'kitchen', 'sanitation', 'living', 'build', 'general',
];
const SOURCES: readonly AcquisitionSource[] = ['buy_new', 'second_hand', 'borrow_member'];
const STATUSES: readonly AcquisitionStatus[] = ['to_search', 'in_review', 'ordered', 'arrived'];

/**
 * Ordered by what still has to happen. `to_search` is the row nobody has
 * started; `arrived` is finished and sorts last. Alphabetical order on the
 * stored value would put `arrived` first by accident of spelling.
 */
const STATUS_RANK: Record<AcquisitionStatus, number> = {
  to_search: 0,
  in_review: 1,
  ordered: 2,
  arrived: 3,
};

/** The two people a row can name. Aliased, because both are `persons`. */
const assigneeTable = sql.raw('assignee');
const lenderTable = sql.raw('lender');

/** This season's rows, plus the camp-wide ones that belong to every season. */
function inSeason(seasonId: string) {
  return or(eq(acquisitionItems.seasonId, seasonId), isNull(acquisitionItems.seasonId));
}

function predicate(seasonId: string, query: AcquisitionQuery) {
  const clauses = [inSeason(seasonId)];

  const status = statusOf(query.view);
  if (status !== null) clauses.push(eq(acquisitionItems.status, status));
  if (query.category) clauses.push(eq(acquisitionItems.category, query.category));
  if (query.q) clauses.push(ilike(acquisitionItems.name, `%${query.q}%`));

  return and(...clauses);
}

function ordering(query: AcquisitionQuery) {
  const dir = query.dir === 'desc' ? desc : asc;
  switch (query.sort) {
    case 'name': return [dir(acquisitionItems.name)];
    case 'category': return [dir(acquisitionItems.category), asc(acquisitionItems.name)];
    /* By the row's estimate — what the column shows — not by the unit price
       behind it: 200 screws at 1 ₪ outrank one drill at 150 ₪. */
    case 'estimate': return [
      dir(sql`${acquisitionItems.estimatedCost} * ${acquisitionItems.quantityNeeded}`),
      asc(acquisitionItems.name),
    ];
    case 'actual': return [dir(acquisitionItems.actualCost), asc(acquisitionItems.name)];
    case 'assignee': return [dir(acquisitionItems.assigneePersonId), asc(acquisitionItems.name)];
    case 'status':
    default:
      return [
        dir(sql`case ${acquisitionItems.status}
          when 'to_search' then ${STATUS_RANK.to_search}
          when 'in_review' then ${STATUS_RANK.in_review}
          when 'ordered' then ${STATUS_RANK.ordered}
          else ${STATUS_RANK.arrived} end`),
        asc(acquisitionItems.name),
      ];
  }
}

/**
 * The two person joins are `left`, and deliberately so: a row with nobody
 * responsible is a real and common state early in a season, and an inner join
 * would make those rows vanish from the list that exists to find them.
 */
function selection(db: AnyDb) {
  return db
    .select({
      row: acquisitionItems,
      assigneeName: sql<string | null>`${assigneeTable}.display_name`,
      lenderName: sql<string | null>`${lenderTable}.display_name`,
      workItemId: workItems.id,
      workItemSeasonId: workItems.seasonId,
    })
    .from(acquisitionItems)
    .leftJoin(
      sql`${persons} as ${assigneeTable}`,
      sql`${assigneeTable}.id = ${acquisitionItems.assigneePersonId}`,
    )
    .leftJoin(
      sql`${persons} as ${lenderTable}`,
      sql`${lenderTable}.id = ${acquisitionItems.lenderPersonId}`,
    )
    /* One line per purchase at most: `work_items.acquisition_item_id` is unique. */
    .leftJoin(workItems, eq(workItems.acquisitionItemId, acquisitionItems.id));
}

type SelectedRow = {
  row: typeof acquisitionItems.$inferSelect;
  assigneeName: string | null;
  lenderName: string | null;
  workItemId: string | null;
  workItemSeasonId: string | null;
};

function toRow({ row, assigneeName, lenderName, workItemId, workItemSeasonId }: SelectedRow): AcquisitionRow {
  const unitEstimateAgorot = row.estimatedCost === null ? null : toAgorot(row.estimatedCost);
  return {
    id: row.id,
    seasonId: row.seasonId,
    name: row.name,
    category: row.category,
    quantityNeeded: row.quantityNeeded,
    source: row.source,
    unitEstimateAgorot,
    estimatedAgorot: rowEstimateAgorot(unitEstimateAgorot, row.quantityNeeded),
    actualAgorot: row.actualCost === null ? null : toAgorot(row.actualCost),
    assignee: row.assigneePersonId === null || assigneeName === null
      ? null : { id: row.assigneePersonId, name: assigneeName },
    lender: row.lenderPersonId === null || lenderName === null
      ? null : { id: row.lenderPersonId, name: lenderName },
    budgetLineId: row.budgetLineId,
    arrivedItemId: row.arrivedItemId,
    workItem: workItemId !== null && workItemSeasonId !== null ? { id: workItemId, seasonId: workItemSeasonId } : null,
    status: row.status,
    updatedAt: row.updatedAt as Date,
    updatedBy: row.updatedBy,
  };
}

export async function listAcquisitions(
  db: AnyDb, seasonId: string, query: AcquisitionQuery,
): Promise<AcquisitionRow[]> {
  const rows = await selection(db)
    .where(predicate(seasonId, query))
    .orderBy(...ordering(query));
  return (rows as SelectedRow[]).map(toRow);
}

export async function acquisitionById(db: AnyDb, id: string): Promise<AcquisitionRow | null> {
  const rows = await selection(db).where(eq(acquisitionItems.id, id)).limit(1);
  const [row] = rows as SelectedRow[];
  return row === undefined ? null : toRow(row);
}

export interface AcquisitionCounts {
  /** Over the whole season: a tab count must not move when a filter is on. */
  byStatus: Record<AcquisitionStatus, number>;
  total: number;
  /** How many of `total` are camp-wide rather than this season's own. */
  campWide: number;
  /** Season totals, for the tiles. */
  estimatedAgorot: number;
  actualAgorot: number;
  /** What the estimate says is still to come — rows that have not arrived. */
  remainingAgorot: number;
  remainingRows: number;
  /** Rows a lead marked as arrived and never wrote into the warehouse. */
  unregisteredArrivals: number;
  budgetLinked: number;
  /** Over the current filter, so the footer agrees with the rows above it. */
  shownRows: number;
  shownEstimatedAgorot: number;
  shownActualAgorot: number;
}

export async function acquisitionCounts(
  db: AnyDb, seasonId: string, query: AcquisitionQuery,
): Promise<AcquisitionCounts> {
  const all = (await selection(db)
    .where(inSeason(seasonId)) as SelectedRow[]).map(toRow);
  const shown = await listAcquisitions(db, seasonId, query);

  const sum = (rows: AcquisitionRow[], of: 'estimatedAgorot' | 'actualAgorot') =>
    rows.reduce((total, row) => total + (row[of] ?? 0), 0);

  const remaining = all.filter((row) => row.status !== 'arrived');

  return {
    byStatus: Object.fromEntries(
      STATUSES.map((status) => [status, all.filter((row) => row.status === status).length]),
    ) as Record<AcquisitionStatus, number>,
    total: all.length,
    campWide: all.filter((row) => row.seasonId === null).length,
    estimatedAgorot: sum(all, 'estimatedAgorot'),
    actualAgorot: sum(all, 'actualAgorot'),
    remainingAgorot: sum(remaining, 'estimatedAgorot'),
    remainingRows: remaining.length,
    unregisteredArrivals: all.filter(
      (row) => row.status === 'arrived' && row.arrivedItemId === null,
    ).length,
    budgetLinked: all.filter((row) => row.budgetLineId !== null).length,
    shownRows: shown.length,
    shownEstimatedAgorot: sum(shown, 'estimatedAgorot'),
    shownActualAgorot: sum(shown, 'actualAgorot'),
  };
}

/**
 * What the create and edit drawers send. Costs arrive as the strings a lead
 * typed and are normalised here through `toAgorot`/`fromAgorot`, so no screen
 * does arithmetic on a float.
 */
export interface AcquisitionInput {
  /**
   * The season the need belongs to, or null for camp-wide. Part of the input
   * rather than a separate call so an edit can move a row between "this
   * year's" and "every year's" the same way it changes anything else.
   */
  seasonId: string | null;
  name: string;
  category: LogisticsCategory;
  quantityNeeded: number;
  source: AcquisitionSource;
  /** The price of one. The row's estimate is this times `quantityNeeded`. */
  estimatedCost: string | null;
  /** What was paid for all of them. */
  actualCost: string | null;
  assigneePersonId: string | null;
  lenderPersonId: string | null;
  budgetLineId: string | null;
}

/** English, for a stack trace; `failure-messages.ts` maps each prefix (R9). */
function validate(input: AcquisitionInput): void {
  if (isBlank(input.name)) throw new Error('an acquisition must have a name');
  if (!Number.isInteger(input.quantityNeeded) || input.quantityNeeded < 1) {
    throw new Error('an acquisition quantity must be a whole number, one or more');
  }
  if (!CATEGORIES.includes(input.category)) throw new Error(`unknown category: ${input.category}`);
  if (!SOURCES.includes(input.source)) throw new Error(`unknown source: ${input.source}`);
  if (input.source === 'borrow_member' && input.lenderPersonId === null) {
    /* A thing borrowed from nobody is a promise nobody can keep: at the end of
       the burn there is an object and no name to return it to. */
    throw new Error('a borrowed acquisition must name the lender');
  }
}

/** `null` stays null; a typed amount is normalised to two decimals. */
function money(value: string | null): string | null {
  if (value === null || isBlank(value)) return null;
  return fromAgorot(toAgorot(value.trim()));
}

function clean(input: AcquisitionInput) {
  return {
    seasonId: input.seasonId,
    name: input.name.trim(),
    category: input.category,
    quantityNeeded: input.quantityNeeded,
    source: input.source,
    estimatedCost: money(input.estimatedCost),
    actualCost: money(input.actualCost),
    assigneePersonId: input.assigneePersonId,
    /* Only a borrowed row keeps a lender. Leaving one behind after a lead
       switched the row to "buy new" would have the screen offering to return
       something to somebody who never owned it. */
    lenderPersonId: input.source === 'borrow_member' ? input.lenderPersonId : null,
    budgetLineId: input.budgetLineId,
  };
}

/**
 * Where a new purchase's line goes on the work plan: which season's board,
 * and under which topic (null is ״בלי נושא״). The drawer passes the season
 * on screen and the topic the lead picked.
 */
export interface PlanPlacement {
  seasonId: string;
  topicId: string | null;
}

/**
 * Every purchase is a line on the work plan, made here, in the same
 * transaction as the row: a lead who enters what to buy has said what has
 * to get done, and typing it twice is how the two lists drift apart.
 *
 * Without a placement, a season's row goes on that season's board under
 * no topic. A camp-wide row names no season, so with no placement it gets
 * no line — the system does not pick a year for it — and the drawer always
 * passes one.
 */
export async function createAcquisition(
  db: AnyDb, input: AcquisitionInput, actor: string, plan?: PlanPlacement | null,
): Promise<string> {
  validate(input);
  const placement = plan ?? (input.seasonId === null ? null : { seasonId: input.seasonId, topicId: null });

  return (db as Db).transaction(async (tx) => {
    const scoped = tx as unknown as AnyDb;
    const [row] = await scoped.insert(acquisitionItems)
      .values({ ...clean(input), updatedBy: actor })
      .returning();
    if (placement !== null) {
      const itemId = await createPlanItem(scoped, placement.seasonId, {
        title: purchaseTitle(input.source, input.name, input.quantityNeeded),
        notes: null,
        topicId: placement.topicId,
        parentId: null,
        startsOn: null,
        endsOn: null,
        assigneePersonId: input.assigneePersonId,
      }, actor);
      await scoped.update(workItems).set({ acquisitionItemId: row.id }).where(eq(workItems.id, itemId));
    }
    return row.id;
  });
}

/**
 * The line on the board follows its purchase: the title is rebuilt from
 * the name, the count and the way of getting it, the person is the row's,
 * and done means arrived. A cancelled line is left alone — that was the
 * board's decision, and a delivery does not reverse it.
 */
async function followPurchase(db: AnyDb, acquisitionId: string, actor: string): Promise<void> {
  const [row] = await db.select().from(acquisitionItems).where(eq(acquisitionItems.id, acquisitionId));
  const [item] = await db.select({ id: workItems.id, status: workItems.status }).from(workItems)
    .where(eq(workItems.acquisitionItemId, acquisitionId));
  if (!row || !item) return;
  const status = item.status === 'cancelled' ? 'cancelled'
    : row.status === 'arrived' ? 'done' : 'open';
  await db.update(workItems).set({
    title: purchaseTitle(row.source, row.name, row.quantityNeeded),
    assigneePersonId: row.assigneePersonId,
    status,
    updatedAt: new Date(),
    updatedBy: actor,
  }).where(eq(workItems.id, item.id));
}

export async function updateAcquisition(
  db: AnyDb, id: string, input: AcquisitionInput, actor: string,
): Promise<void> {
  validate(input);
  if (!(await acquisitionById(db, id))) throw new Error(`unknown acquisition ${id}`);

  /* One transaction, as `createAcquisition` is: a row renamed whose line
     kept the old name is the two lists disagreeing with nothing to say so. */
  await (db as Db).transaction(async (tx) => {
    const scoped = tx as unknown as AnyDb;
    await scoped.update(acquisitionItems)
      .set({ ...clean(input), updatedBy: actor, updatedAt: new Date() })
      .where(eq(acquisitionItems.id, id));
    await followPurchase(scoped, id, actor);
  });
}

/**
 * The rows a board item could be the line of: this season's and the
 * camp-wide ones, not yet arrived, that no work item points at. Rows
 * written before purchases had lines are all like this.
 */
async function unlinkedRows(db: AnyDb, seasonId: string) {
  const rows = await db.select({
    id: acquisitionItems.id, name: acquisitionItems.name, status: acquisitionItems.status,
    source: acquisitionItems.source, quantityNeeded: acquisitionItems.quantityNeeded,
  }).from(acquisitionItems)
    .leftJoin(workItems, eq(workItems.acquisitionItemId, acquisitionItems.id))
    .where(and(
      isNull(workItems.id),
      or(eq(acquisitionItems.seasonId, seasonId), isNull(acquisitionItems.seasonId)),
    ));
  return rows.filter((row) => row.status !== 'arrived');
}
type UnlinkedRow = Awaited<ReturnType<typeof unlinkedRows>>[number];

/**
 * One item against the list. Names are compared normalised — a geresh and
 * an apostrophe are one spelling to a reader — and never stored that way.
 * A row of the same name wins over what the verb says: ״להשאיל אוהל״ with
 * a borrowed ״אוהל״ already in the list is that row's line.
 */
function outcomeOf(title: string, rows: readonly UnlinkedRow[]): AdoptOutcome {
  const reading = readPurchase(title);
  const key = normalizeHebrew(reading.name);
  const same = rows.filter((row) => normalizeHebrew(row.name) === key);
  const fresh = { ...reading, existing: null, boardTitle: purchaseTitle(reading.source, reading.name, 1) };
  if (same.length > 1) return { ...fresh, refusal: 'ambiguous' };
  if (same.length === 1) {
    const [row] = same;
    return {
      source: row.source, name: row.name, existing: { id: row.id, name: row.name },
      boardTitle: purchaseTitle(row.source, row.name, row.quantityNeeded), refusal: null,
    };
  }
  return { ...fresh, refusal: reading.source === 'borrow_member' ? 'needs_lender' : null };
}

/**
 * What the move would do with each of these items, for the drawer to say
 * before anything is pressed. The move itself asks again, inside its
 * transaction — this is a preview, not a promise.
 */
export async function adoptOutcomes(
  db: AnyDb, seasonId: string, items: readonly { id: string; title: string }[],
): Promise<Map<string, AdoptOutcome>> {
  if (items.length === 0) return new Map();
  const rows = await unlinkedRows(db, seasonId);
  return new Map(items.map((item) => [item.id, outcomeOf(item.title, rows)]));
}

/**
 * The one-time move the board asked for: open items that are really
 * things to get become rows in the list, each linked to its item. The
 * item stays on the board — that is where a purchase lives from now on —
 * titled from the row (״קניית קרשים״ → ״לקנות קרשים״), with its person
 * carried over. Category, count and cost are the row's defaults: the
 * title says none of them, and the list is where they get filled in.
 *
 * An item whose thing is already a row in the list is linked to that row
 * instead: a second ״מכולה״ beside the first is the drift this link exists
 * to end. Two rows of the name, or a borrowed thing with no lender, are
 * refused — neither is the system's to decide.
 *
 * All or nothing. A refusal names the item, and the rows written before
 * it are rolled back, so a half-moved board cannot happen.
 */
export async function adoptPurchaseItems(
  db: AnyDb, seasonId: string, itemIds: readonly string[], actor: string,
): Promise<number> {
  if (itemIds.length === 0) throw new Error('nothing was chosen to move to the acquisitions list');

  return (db as Db).transaction(async (tx) => {
    const scoped = tx as unknown as AnyDb;
    for (const itemId of itemIds) {
      const [item] = UUID.test(itemId)
        ? await scoped.select().from(workItems).where(eq(workItems.id, itemId))
        : [];
      if (!item || item.seasonId !== seasonId) throw new Error(`unknown work item ${itemId}`);
      if (item.acquisitionItemId !== null) throw new Error(`work item ${itemId} is already in the acquisitions list`);
      if (item.status !== 'open') throw new Error(`work item ${itemId} is not open`);

      /* Read again for every item: the one before it may have taken a row. */
      const outcome = outcomeOf(item.title, await unlinkedRows(scoped, seasonId));
      if (outcome.refusal === 'ambiguous') throw new Error(`several acquisitions share the name of work item ${itemId}`);
      if (outcome.refusal === 'needs_lender') throw new Error(`a borrowed work item needs a lender: ${itemId}`);

      let rowId: string;
      if (outcome.existing !== null) {
        rowId = outcome.existing.id;
        /* The row keeps its own person; the item's fills only a blank. */
        if (item.assigneePersonId !== null) {
          await scoped.update(acquisitionItems)
            .set({ assigneePersonId: item.assigneePersonId, updatedAt: new Date(), updatedBy: actor })
            .where(and(eq(acquisitionItems.id, rowId), isNull(acquisitionItems.assigneePersonId)));
        }
      } else {
        const [row] = await scoped.insert(acquisitionItems).values({
          seasonId,
          name: outcome.name,
          category: 'general',
          quantityNeeded: 1,
          source: outcome.source,
          assigneePersonId: item.assigneePersonId,
          updatedBy: actor,
        }).returning();
        rowId = row.id;
      }
      /* Only while it is still unlinked: two leads pressing at once must not
         leave the loser's row behind with no line. */
      const linked = await scoped.update(workItems)
        .set({ acquisitionItemId: rowId })
        .where(and(eq(workItems.id, item.id), isNull(workItems.acquisitionItemId)))
        .returning();
      if (linked.length === 0) throw new Error(`work item ${itemId} is already in the acquisitions list`);
      await followPurchase(scoped, rowId, actor);
    }
    return itemIds.length;
  });
}

/**
 * Moves a row along without touching the warehouse.
 *
 * Setting `arrived` here is the open-decision case on purpose: somebody says
 * the thing came, and the system does not know which box it went into or what
 * state it arrived in. It holds that gap as a row the screen surfaces —
 * `unregisteredArrivals` — rather than inventing a location for it.
 */
export async function setAcquisitionStatus(
  db: AnyDb, id: string, status: AcquisitionStatus, actor: string,
): Promise<void> {
  if (!STATUSES.includes(status)) throw new Error(`unknown status: ${status}`);
  if (!(await acquisitionById(db, id))) throw new Error(`unknown acquisition ${id}`);

  /* One transaction: an arrived row whose line stayed open would read as
     work still to do on the board. */
  await (db as Db).transaction(async (tx) => {
    const scoped = tx as unknown as AnyDb;
    await scoped.update(acquisitionItems)
      .set({ status, updatedBy: actor, updatedAt: new Date() })
      .where(eq(acquisitionItems.id, id));
    await followPurchase(scoped, id, actor);
  });
}

export interface ArrivalInput {
  acquisitionId: string;
  /**
   * The two answers the drawer asks for. `new` describes a shelf that does not
   * hold this yet; `existing` says it is more of something the camp already
   * owns. Neither is inferred: the system knows a thing arrived, and nothing
   * about where it was put.
   */
  target:
    | { kind: 'new'; locationText: string; condition: ItemCondition }
    | { kind: 'existing'; itemId: string };
  quantity: number;
  /** Optional at this moment, so spend can still be tied to the budget later. */
  budgetLineId: string | null;
}

/**
 * The one place the two halves of logistics meet: an order becomes stock.
 *
 * In a transaction, because the failure it prevents is concrete — the
 * inventory row is written, the link back fails, and the warehouse grows a
 * row nobody ordered that no acquisition points at. The cast is the one
 * `promote.ts` and `run-import.ts` already use: `Db` and `TestDb` each type
 * `.transaction()` against their own driver, so a callback typed against the
 * union satisfies neither for TypeScript.
 *
 * Returns the inventory item's id — new or existing — so the screen can link
 * straight to the thing it just put on a shelf.
 */
export async function recordArrival(
  db: AnyDb, input: ArrivalInput, actor: string,
): Promise<string> {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new Error('an arriving quantity must be a whole number, one or more');
  }
  if (input.target.kind === 'new' && isBlank(input.target.locationText)) {
    throw new Error('an inventory item must have a location');
  }

  return (db as Db).transaction(async (tx) => {
    const scoped = tx as unknown as AnyDb;

    const acquisition = await acquisitionById(scoped, input.acquisitionId);
    if (!acquisition) throw new Error(`unknown acquisition ${input.acquisitionId}`);
    if (acquisition.arrivedItemId !== null) {
      /* Registering twice would add the quantity again and orphan the first
         warehouse row, leaving two answers to "what does the camp own". */
      throw new Error(`acquisition ${input.acquisitionId} is already registered in the warehouse`);
    }

    let itemId: string;
    if (input.target.kind === 'existing') {
      if (!(await itemById(scoped, input.target.itemId))) {
        throw new Error(`unknown inventory item ${input.target.itemId}`);
      }
      await addToItem(scoped, input.target.itemId, input.quantity, actor);
      itemId = input.target.itemId;
    } else {
      itemId = await createItem(scoped, {
        /* The same thing under the same name and category: a lead who
           searched the warehouse for what they ordered should find it. */
        name: acquisition.name,
        category: acquisition.category,
        quantity: input.quantity,
        /* Not in a box: the arrival drawer asks for a place in words and
           offers no box yet. Putting an arrival straight into a box is a
           drawer change, not a library one. */
        boxId: null,
        locationText: input.target.locationText,
        condition: input.target.condition,
        notes: null,
      }, actor);
    }

    await scoped.update(acquisitionItems)
      .set({
        status: 'arrived',
        arrivedItemId: itemId,
        budgetLineId: input.budgetLineId ?? acquisition.budgetLineId,
        updatedBy: actor,
        updatedAt: new Date(),
      })
      .where(eq(acquisitionItems.id, input.acquisitionId));
    await followPurchase(scoped, input.acquisitionId, actor);

    return itemId;
  });
}
