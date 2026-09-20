import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import type { AnyDb } from '@/lib/db-types';
import { isBlank } from '@/lib/text/normalize';
import { toAgorot, fromAgorot } from '@/lib/money';
import { persons } from '@/db/schema/camp';
import {
  acquisitionItems,
  type AcquisitionSource, type AcquisitionStatus, type LogisticsCategory,
  type ItemCondition,
} from '@/db/schema/logistics';
import { createItem, addToItem, itemById } from './warehouse';
import { statusOf, type AcquisitionQuery } from './acquisitions-views';

/**
 * What the camp still needs for one season, and what happened to each of
 * those needs.
 *
 * The warehouse and this module disagree about seasons on purpose: gear
 * outlives a burn, a shopping list does not. They meet in one place —
 * `recordArrival`, below — and that meeting is a decision a lead makes, never
 * one this module infers.
 */

export interface PersonRef { id: string; name: string }

export interface AcquisitionRow {
  id: string;
  name: string;
  category: LogisticsCategory;
  quantityNeeded: number;
  source: AcquisitionSource;
  /** Null is "nobody has priced it", which is not the same as free. */
  estimatedAgorot: number | null;
  /** Null is "not bought yet", which is not the same as it having cost zero. */
  actualAgorot: number | null;
  assignee: PersonRef | null;
  lender: PersonRef | null;
  budgetLineId: string | null;
  arrivedItemId: string | null;
  status: AcquisitionStatus;
  updatedAt: Date;
  updatedBy: string | null;
}

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

function predicate(seasonId: string, query: AcquisitionQuery) {
  const clauses = [eq(acquisitionItems.seasonId, seasonId)];

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
    case 'estimate': return [dir(acquisitionItems.estimatedCost), asc(acquisitionItems.name)];
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
    })
    .from(acquisitionItems)
    .leftJoin(
      sql`${persons} as ${assigneeTable}`,
      sql`${assigneeTable}.id = ${acquisitionItems.assigneePersonId}`,
    )
    .leftJoin(
      sql`${persons} as ${lenderTable}`,
      sql`${lenderTable}.id = ${acquisitionItems.lenderPersonId}`,
    );
}

type SelectedRow = {
  row: typeof acquisitionItems.$inferSelect;
  assigneeName: string | null;
  lenderName: string | null;
};

function toRow({ row, assigneeName, lenderName }: SelectedRow): AcquisitionRow {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    quantityNeeded: row.quantityNeeded,
    source: row.source,
    estimatedAgorot: row.estimatedCost === null ? null : toAgorot(row.estimatedCost),
    actualAgorot: row.actualCost === null ? null : toAgorot(row.actualCost),
    assignee: row.assigneePersonId === null || assigneeName === null
      ? null : { id: row.assigneePersonId, name: assigneeName },
    lender: row.lenderPersonId === null || lenderName === null
      ? null : { id: row.lenderPersonId, name: lenderName },
    budgetLineId: row.budgetLineId,
    arrivedItemId: row.arrivedItemId,
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
    .where(eq(acquisitionItems.seasonId, seasonId)) as SelectedRow[]).map(toRow);
  const shown = await listAcquisitions(db, seasonId, query);

  const sum = (rows: AcquisitionRow[], of: 'estimatedAgorot' | 'actualAgorot') =>
    rows.reduce((total, row) => total + (row[of] ?? 0), 0);

  const remaining = all.filter((row) => row.status !== 'arrived');

  return {
    byStatus: Object.fromEntries(
      STATUSES.map((status) => [status, all.filter((row) => row.status === status).length]),
    ) as Record<AcquisitionStatus, number>,
    total: all.length,
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
  name: string;
  category: LogisticsCategory;
  quantityNeeded: number;
  source: AcquisitionSource;
  estimatedCost: string | null;
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

export async function createAcquisition(
  db: AnyDb, seasonId: string, input: AcquisitionInput, actor: string,
): Promise<string> {
  validate(input);
  const [row] = await db.insert(acquisitionItems)
    .values({ ...clean(input), seasonId, updatedBy: actor })
    .returning();
  return row.id;
}

export async function updateAcquisition(
  db: AnyDb, id: string, input: AcquisitionInput, actor: string,
): Promise<void> {
  validate(input);
  if (!(await acquisitionById(db, id))) throw new Error(`unknown acquisition ${id}`);

  await db.update(acquisitionItems)
    .set({ ...clean(input), updatedBy: actor, updatedAt: new Date() })
    .where(eq(acquisitionItems.id, id));
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

  await db.update(acquisitionItems)
    .set({ status, updatedBy: actor, updatedAt: new Date() })
    .where(eq(acquisitionItems.id, id));
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

    return itemId;
  });
}
