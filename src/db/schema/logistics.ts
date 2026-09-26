import {
  pgTable, uuid, text, integer, timestamp, numeric,
} from 'drizzle-orm/pg-core';
import { persons, seasons, tasks } from './camp';
import { budgetLines } from './money';
import { blocks } from './source';

export type LogisticsCategory =
  | 'kitchen' | 'sanitation' | 'living' | 'build' | 'general';

/**
 * `retired` is the fourth state the original requirements did not ask for.
 * It exists because this product does not delete: a pump broken beyond repair
 * becomes a row that says so. An absence is indistinguishable from "nobody has
 * entered it yet", which is the ambiguity the whole platform exists to remove.
 */
export type ItemCondition = 'ready' | 'needs_testing' | 'needs_repair' | 'retired';

export type AcquisitionSource = 'buy_new' | 'second_hand' | 'borrow_member';
export type AcquisitionStatus = 'to_search' | 'in_review' | 'ordered' | 'arrived';

/**
 * A box: a named container with one place in the warehouse.
 *
 * It exists so that an item can be located by what it is in rather than by
 * where it is. Standing in the container, a lead fills ״ארגז כחול #1״ with
 * twenty things and knows where the box is; typing that place twenty times
 * is how a location column grows five spellings of one shelf. The box carries
 * the place once, and an item inside it needs none of its own.
 *
 * No season, for the same reason `inventoryItems` has none: a box is owned,
 * not needed. There is no delete either — this product does not delete — so
 * an emptied box stays listed and says it is empty.
 */
export const inventoryBoxes = pgTable('inventory_boxes', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  /** Where the box itself is, free text. Required: a box nobody can find
   *  locates nothing. */
  locationText: text('location_text').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

/**
 * What the camp physically owns, and where it is.
 *
 * **There is deliberately no `season_id`.** A pump owned in ברן 25 is still
 * owned in ברן 26; scoping the warehouse to a season would mean re-entering it
 * every year, which nobody would do, and a stale inventory is worse than none.
 * R5 requires camp-wide data to say so on screen rather than quietly ignore
 * `?season=`, and `/logistics/warehouse` does.
 *
 * An item is located either by `boxId` or by `locationText`, and the library
 * refuses a row with neither. Inside a box the text is optional detail
 * (״בתחתית״); outside one it is the whole answer to "where".
 *
 * `sourceBlockId` / `sourceRow` are reserved and always null today: there is no
 * gear workbook, so every quantity renders `נרשם ידנית` under R11. They exist
 * so that a future import has somewhere to put provenance without a migration
 * that rewrites rows people have been editing by hand.
 */
export const inventoryItems = pgTable('inventory_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  category: text('category').$type<LogisticsCategory>().notNull().default('general'),
  quantity: integer('quantity').notNull().default(0),
  /** The box this is in, if it is in one. `set null` rather than cascade: a
   *  box row is never deleted by this product, and if one ever is, the items
   *  in it are still owned — they become unlocated, which the screen shows. */
  boxId: uuid('box_id').references(() => inventoryBoxes.id, { onDelete: 'set null' }),
  /** Free text, written the way it is written on the box itself. */
  locationText: text('location_text'),
  condition: text('condition').$type<ItemCondition>().notNull().default('ready'),
  notes: text('notes'),
  sourceBlockId: uuid('source_block_id').references(() => blocks.id, { onDelete: 'set null' }),
  sourceRow: integer('source_row'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

/**
 * What is missing for one season and has to be bought, found or borrowed.
 *
 * Season-scoped, unlike the warehouse: what the camp still needs is usually a
 * fact about this year. `seasonId` is nullable for the exception — a thing the
 * camp needs whichever burn comes next (a generator, a water pump). A null
 * season means camp-wide: the row is listed under every season and says so on
 * screen, rather than being copied into each year by hand and drifting.
 *
 * Stock and want are separate rows on purpose — the camp can need four more
 * of something it already has two of, and folding them into one row would
 * make the warehouse count absorb an order that has not arrived.
 *
 * Amounts are `numeric(12,2)` to match `budget_lines`; the code works in
 * agorot via `toAgorot` / `formatILS`. Both are nullable because "not bought
 * yet" and "cost nothing" are different facts and must not collapse to zero.
 */
export const acquisitionItems = pgTable('acquisition_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** Null is camp-wide: needed regardless of which burn is next. */
  seasonId: uuid('season_id')
    .references(() => seasons.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: text('category').$type<LogisticsCategory>().notNull().default('general'),
  quantityNeeded: integer('quantity_needed').notNull().default(1),
  source: text('source').$type<AcquisitionSource>().notNull().default('buy_new'),
  estimatedCost: numeric('estimated_cost', { precision: 12, scale: 2 }),
  actualCost: numeric('actual_cost', { precision: 12, scale: 2 }),
  /** Who is responsible for getting it. A person on the roster, never free text. */
  assigneePersonId: uuid('assignee_person_id')
    .references(() => persons.id, { onDelete: 'set null' }),
  /** Optional link to the camp budget, so spend lives in one place (R11). */
  budgetLineId: uuid('budget_line_id')
    .references(() => budgetLines.id, { onDelete: 'set null' }),
  /** Only meaningful when `source` is `borrow_member`: whose property this is. */
  lenderPersonId: uuid('lender_person_id')
    .references(() => persons.id, { onDelete: 'set null' }),
  /**
   * Set only when a lead confirms the arrival decision. Arrival never creates
   * this link on its own: the system does not know which box the thing went
   * into or what condition it arrived in, and it does not guess.
   */
  arrivedItemId: uuid('arrived_item_id')
    .references(() => inventoryItems.id, { onDelete: 'set null' }),
  status: text('status').$type<AcquisitionStatus>().notNull().default('to_search'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

/**
 * What a build task needs in order to happen.
 *
 * **No status column.** Whether a material is `במחסן`, `הושג` or
 * `צריך להשיג` is derived from the two links below at read time. A stored
 * status would still read `במחסן` after somebody took the thing, and the
 * checklist would then lie about what the camp has.
 *
 * `taskId` cascades because a deleted task has no requirements. The two
 * optional links `set null` because a material that loses its stock row or its
 * order becomes "needs acquiring" — it never disappears along with the thing
 * it was pointing at.
 */
export const taskMaterials = pgTable('task_materials', {
  id: uuid('id').defaultRandom().primaryKey(),
  taskId: uuid('task_id').notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  quantityNeeded: integer('quantity_needed').notNull().default(1),
  inventoryItemId: uuid('inventory_item_id')
    .references(() => inventoryItems.id, { onDelete: 'set null' }),
  acquisitionItemId: uuid('acquisition_item_id')
    .references(() => acquisitionItems.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
