import { asc, eq, sql } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { isBlank } from '@/lib/text/normalize';
import { inventoryBoxes, inventoryItems } from '@/db/schema/logistics';

/**
 * The boxes in the warehouse: a named container with one place.
 *
 * A box is how an item gets a location without being given one. A lead in
 * the container fills ״ארגז כחול #1״ with twenty things; the box says where
 * it is, and the twenty rows say only which box they are in. The reads and
 * writes for the box rows live here; what is *in* a box is a question about
 * items, and `warehouse.ts` answers it (`itemsInBox`), because that is the
 * module that knows how an item row is shaped.
 */

export interface BoxRow {
  id: string;
  name: string;
  locationText: string;
  notes: string | null;
  updatedBy: string | null;
  updatedAt: Date;
  /** How many item rows point at this box — retired ones included, because a
   *  retired saw still takes up the space. Zero reads as "empty box". */
  itemCount: number;
  /** The sum of those rows' quantities. */
  quantity: number;
}

const COUNT = sql<number>`count(${inventoryItems.id})`;
const QUANTITY = sql<number>`coalesce(sum(${inventoryItems.quantity}), 0)`;

function rowsQuery(db: AnyDb) {
  return db
    .select({
      id: inventoryBoxes.id,
      name: inventoryBoxes.name,
      locationText: inventoryBoxes.locationText,
      notes: inventoryBoxes.notes,
      updatedBy: inventoryBoxes.updatedBy,
      updatedAt: inventoryBoxes.updatedAt,
      itemCount: COUNT,
      quantity: QUANTITY,
    })
    .from(inventoryBoxes)
    .leftJoin(inventoryItems, eq(inventoryItems.boxId, inventoryBoxes.id))
    .groupBy(inventoryBoxes.id);
}

/* `count()` and `sum()` come back from the driver as strings for a bigint,
   and a `'3'` rendered next to a `3` is invisible until somebody adds them. */
function shaped(row: Omit<BoxRow, 'itemCount' | 'quantity'> & { itemCount: unknown; quantity: unknown }): BoxRow {
  return { ...row, itemCount: Number(row.itemCount), quantity: Number(row.quantity) };
}

/** Every box, by name. There is no filter: a warehouse has a handful. */
export async function listBoxes(db: AnyDb): Promise<BoxRow[]> {
  const rows = await rowsQuery(db).orderBy(asc(inventoryBoxes.name));
  return rows.map(shaped);
}

/** Null rather than a throw: the id comes from a URL someone may have edited. */
export async function boxById(db: AnyDb, id: string): Promise<BoxRow | null> {
  const [row] = await rowsQuery(db).where(eq(inventoryBoxes.id, id)).limit(1);
  return row === undefined ? null : shaped(row);
}

/**
 * What the box drawer sends, in both of its modes. Every field is present
 * every time, for the reason `ItemInput` gives: a missing field on a create
 * and a missing field on an edit would mean two different things.
 */
export interface BoxInput {
  name: string;
  locationText: string;
  notes: string | null;
}

/**
 * English, on purpose: `src/lib` throws for whoever reads a stack trace, and
 * the Hebrew a lead sees is mapped at the action boundary by
 * `failure-messages.ts` (R9). Every message is a stable prefix that file keys on.
 */
function validate(input: BoxInput): void {
  if (isBlank(input.name)) {
    throw new Error('an inventory box must have a name');
  }
  if (isBlank(input.locationText)) {
    // The whole point of a box is that it locates what is in it. A box with
    // no place would let twenty items be "located" nowhere at once.
    throw new Error('an inventory box must have a location');
  }
}

function clean(input: BoxInput) {
  return {
    name: input.name.trim(),
    locationText: input.locationText.trim(),
    notes: input.notes === null || isBlank(input.notes) ? null : input.notes.trim(),
  };
}

/** Returns the new row's id, so the drawer can open over the box it just made. */
export async function createBox(db: AnyDb, input: BoxInput, actor: string): Promise<string> {
  validate(input);
  const [row] = await db.insert(inventoryBoxes)
    .values({ ...clean(input), updatedBy: actor })
    .returning();
  return row.id;
}

/**
 * Checked before it writes, as `updateItem` is: an `update` whose `where`
 * matches nothing succeeds and changes nothing, and the drawer would close on
 * a save that never happened.
 */
export async function updateBox(
  db: AnyDb, id: string, input: BoxInput, actor: string,
): Promise<void> {
  validate(input);
  if (!(await boxById(db, id))) throw new Error(`unknown inventory box ${id}`);

  await db.update(inventoryBoxes)
    .set({ ...clean(input), updatedBy: actor, updatedAt: new Date() })
    .where(eq(inventoryBoxes.id, id));
}
