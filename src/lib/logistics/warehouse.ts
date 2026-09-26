import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { isBlank } from '@/lib/text/normalize';
import { inventoryItems, type ItemCondition, type LogisticsCategory } from '@/db/schema/logistics';
import type { WarehouseQuery } from './warehouse-views';

export interface WarehouseRow {
  id: string;
  name: string;
  category: LogisticsCategory;
  quantity: number;
  locationText: string | null;
  condition: ItemCondition;
  notes: string | null;
  updatedBy: string | null;
  updatedAt: Date;
}

/**
 * Worst first. Somebody opening the warehouse is asking what has to be dealt
 * with before the camp leaves, so the rows that need a decision sort to the
 * top and `retired` sorts last — it is a settled fact, not a to-do.
 */
const CONDITION_RANK: Record<ItemCondition, number> = {
  needs_repair: 0,
  needs_testing: 1,
  ready: 2,
  retired: 3,
};

const ATTENTION: readonly ItemCondition[] = ['needs_testing', 'needs_repair'];

const CATEGORIES: readonly LogisticsCategory[] = [
  'kitchen', 'sanitation', 'living', 'build', 'general',
];

/**
 * Every filter in one place, so the list, the counts and the totals row can
 * never disagree about what "the current view" means. They are computed from
 * the same predicate rather than from three hand-written ones.
 */
function predicate(query: WarehouseQuery) {
  const clauses = [];

  if (query.view === 'attention') clauses.push(inArray(inventoryItems.condition, [...ATTENTION]));
  if (query.view === 'retired') clauses.push(eq(inventoryItems.condition, 'retired'));
  if (query.category) clauses.push(eq(inventoryItems.category, query.category));

  if (query.q) {
    const needle = `%${query.q}%`;
    // Name *and* location: "what is in the blue box" is a question people ask
    // while standing in the storage unit, and the search box promises both.
    clauses.push(or(ilike(inventoryItems.name, needle), ilike(inventoryItems.locationText, needle)));
  }

  return clauses.length ? and(...clauses) : undefined;
}

function ordering(query: WarehouseQuery) {
  const dir = query.dir === 'desc' ? desc : asc;
  switch (query.sort) {
    case 'name': return [dir(inventoryItems.name)];
    case 'category': return [dir(inventoryItems.category), asc(inventoryItems.name)];
    case 'quantity': return [dir(inventoryItems.quantity), asc(inventoryItems.name)];
    case 'location': return [dir(inventoryItems.locationText), asc(inventoryItems.name)];
    case 'condition':
    default:
      // Ordered by meaning, not alphabetically. `asc(condition)` would give
      // needs_repair, needs_testing, ready, retired only by accident of
      // spelling, and would silently reorder if a state were ever renamed.
      return [
        dir(sql`case ${inventoryItems.condition}
          when 'needs_repair' then ${CONDITION_RANK.needs_repair}
          when 'needs_testing' then ${CONDITION_RANK.needs_testing}
          when 'ready' then ${CONDITION_RANK.ready}
          else ${CONDITION_RANK.retired} end`),
        asc(inventoryItems.name),
      ];
  }
}

/** The camp's gear. No season: inventory outlives a burn (R5). */
export async function listWarehouse(db: AnyDb, query: WarehouseQuery): Promise<WarehouseRow[]> {
  const rows = await db.select().from(inventoryItems)
    .where(predicate(query))
    .orderBy(...ordering(query));
  return rows as WarehouseRow[];
}

export interface WarehouseCounts {
  /** Per category, over the WHOLE warehouse — a chip count must not move
   *  when a filter is applied, or the control claims there is nothing to
   *  switch to. */
  byCategory: Record<LogisticsCategory, number>;
  /** Over the current filter, so the footer agrees with the rows above it. */
  shownRows: number;
  shownQuantity: number;
  needsTesting: number;
  needsRepair: number;
  retired: number;
  total: number;
  /** The newest edit anywhere in the warehouse; null while it is empty. */
  lastUpdatedAt: Date | null;
}

export async function warehouseCounts(db: AnyDb, query: WarehouseQuery): Promise<WarehouseCounts> {
  const all = await db.select().from(inventoryItems);
  const shown = await listWarehouse(db, query);

  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => [c, all.filter((r) => r.category === c).length]),
  ) as Record<LogisticsCategory, number>;

  const newest = all.reduce<Date | null>((latest, row) => {
    const at = row.updatedAt as Date;
    return latest === null || at > latest ? at : latest;
  }, null);

  return {
    byCategory,
    shownRows: shown.length,
    shownQuantity: shown.reduce((sum, r) => sum + r.quantity, 0),
    needsTesting: all.filter((r) => r.condition === 'needs_testing').length,
    needsRepair: all.filter((r) => r.condition === 'needs_repair').length,
    retired: all.filter((r) => r.condition === 'retired').length,
    total: all.length,
    lastUpdatedAt: newest,
  };
}

/**
 * The places gear is already stored, most-used first — the item drawer offers
 * them as one-tap chips under the location box.
 *
 * Exactly the stored strings, not normalised: a chip's whole point is that the
 * next item lands under the same spelling as the last, so a search for the box
 * keeps finding everything in it. Distinct by the stored value for the same
 * reason; two spellings of one box are two chips, which is the screen telling
 * the lead about the drift rather than hiding it. Retired items count: a
 * retired saw still sits in a real box.
 */
export async function frequentLocations(db: AnyDb, limit = 8): Promise<string[]> {
  const uses = sql<number>`count(*)`;
  const rows = await db
    .select({ location: inventoryItems.locationText, uses })
    .from(inventoryItems)
    .where(isNotNull(inventoryItems.locationText))
    .groupBy(inventoryItems.locationText)
    .orderBy(desc(uses), asc(inventoryItems.locationText))
    .limit(limit);
  return rows
    .map((row) => row.location)
    .filter((location): location is string => location !== null && !isBlank(location));
}

/** Null rather than a throw: the id comes from a URL someone may have edited. */
export async function itemById(db: AnyDb, id: string): Promise<WarehouseRow | null> {
  const [row] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id)).limit(1);
  return (row as WarehouseRow | undefined) ?? null;
}

/**
 * The one write this screen makes. `updatedBy` is recorded because a condition
 * is a judgement — "needs repair" is somebody's opinion about a pump, and in
 * eight months the useful question is whose.
 */
export async function setCondition(
  db: AnyDb, id: string, condition: ItemCondition, actor: string,
): Promise<void> {
  await db.update(inventoryItems)
    .set({ condition, updatedBy: actor, updatedAt: new Date() })
    .where(eq(inventoryItems.id, id));
}

/**
 * What the two drawers on this screen send. Every field is present on both:
 * a create with a missing field and an edit with a missing field would mean
 * two different things — "not entered" against "leave it alone" — and one
 * shape that always carries all six removes the question.
 */
export interface ItemInput {
  name: string;
  category: LogisticsCategory;
  quantity: number;
  locationText: string;
  condition: ItemCondition;
  notes: string | null;
}

/**
 * The refusals, in one place, so the create drawer and the edit drawer cannot
 * drift apart on what counts as a valid item.
 *
 * English, on purpose. `src/lib` throws for whoever is reading a stack trace;
 * the Hebrew a lead sees is mapped at the action boundary by
 * `failure-messages.ts` (R9, integration §5 A7). Every message below is a
 * stable prefix that file keys on.
 */
function validate(input: ItemInput): void {
  if (isBlank(input.name)) {
    throw new Error('an inventory item must have a name');
  }
  if (isBlank(input.locationText)) {
    // The arrival drawer says this out loud on screen: an item nobody can
    // find next year is worth less than a row that was never written, because
    // the row also claims the camp has one.
    throw new Error('an inventory item must have a location');
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 0) {
    // Zero is allowed and is not a blank: "we have none of these" is a fact
    // somebody counted, and the warehouse has to be able to hold it.
    throw new Error('an inventory quantity must be a whole number, zero or more');
  }
  if (!CATEGORIES.includes(input.category)) {
    throw new Error(`unknown category: ${input.category}`);
  }
  if (!(input.condition in CONDITION_RANK)) {
    throw new Error(`unknown condition: ${input.condition}`);
  }
}

/** Trimmed, so a name that differs only by a space is not a second item. */
function clean(input: ItemInput) {
  return {
    name: input.name.trim(),
    category: input.category,
    quantity: input.quantity,
    locationText: input.locationText.trim(),
    condition: input.condition,
    notes: input.notes === null || isBlank(input.notes) ? null : input.notes.trim(),
  };
}

/** Returns the new row's id, so the caller can link to the item it just made. */
export async function createItem(
  db: AnyDb, input: ItemInput, actor: string,
): Promise<string> {
  validate(input);
  /* `.returning()` with no column list: `AnyDb` is a union of the Postgres
     and PGlite handles, and the projected form resolves to neither side's
     overload. Every other write in `src/lib` returns the whole row for the
     same reason. */
  const [row] = await db.insert(inventoryItems)
    .values({ ...clean(input), updatedBy: actor })
    .returning();
  return row.id;
}

/**
 * Checked before it writes. An `update` whose `where` matches no row succeeds
 * and changes nothing, so without this the drawer would close on a save that
 * never happened — the exact silent-success failure this platform exists to
 * remove.
 */
export async function updateItem(
  db: AnyDb, id: string, input: ItemInput, actor: string,
): Promise<void> {
  validate(input);
  if (!(await itemById(db, id))) throw new Error(`unknown inventory item ${id}`);

  await db.update(inventoryItems)
    .set({ ...clean(input), updatedBy: actor, updatedAt: new Date() })
    .where(eq(inventoryItems.id, id));
}

/**
 * More of something the camp already owns — what the acquisitions screen calls
 * when a lead says the thing that arrived belongs in an existing box.
 *
 * It adds rather than replaces, and it never touches the condition: what
 * arrived is not necessarily in the same state as what is already on the
 * shelf, and picking one of the two would be a guess. The arrival drawer asks.
 */
export async function addToItem(
  db: AnyDb, id: string, quantity: number, actor: string,
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error('an arriving quantity must be a whole number, one or more');
  }
  const existing = await itemById(db, id);
  if (!existing) throw new Error(`unknown inventory item ${id}`);

  await db.update(inventoryItems)
    .set({
      quantity: existing.quantity + quantity,
      updatedBy: actor,
      updatedAt: new Date(),
    })
    .where(eq(inventoryItems.id, id));
}
