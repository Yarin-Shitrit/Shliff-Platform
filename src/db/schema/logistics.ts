import {
  pgTable, uuid, text, integer, timestamp, numeric, unique, type AnyPgColumn,
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

/**
 * A kind of shift the camp staffs during the burn — `בר`, `מטבח`, `שער` —
 * with the window and the head-count it usually takes. A type is a template:
 * what gets scheduled is a `tasks` row of kind `shift`, which carries its own
 * copy of the times and the count, so one slot can run longer than the others
 * of its kind without the type changing under them.
 *
 * **No `season_id`**, for the warehouse's reason: the bar is the bar in ברן 26
 * as it was in ברן 25, and a lead should not re-type six shift types every
 * year. The schedule itself is season-scoped, because the tasks are.
 *
 * The clocks are `HH:MM` text, not timestamps: a type has no date. The
 * instant is made when a slot is scheduled, on a day of that season's event,
 * in the camp's time zone (`src/lib/logistics/shift-time.ts`).
 *
 * No delete. A type the camp stopped running is `retired_at`, stays on the
 * slots that used it, and leaves the picker.
 */
export const shiftTypes = pgTable('shift_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  /** `16:00` — when a shift of this kind usually starts. */
  startsClock: text('starts_clock').notNull(),
  /** `20:00`. Earlier than `startsClock` means it ends the next day. */
  endsClock: text('ends_clock').notNull(),
  peopleNeeded: integer('people_needed').notNull().default(1),
  notes: text('notes'),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

/**
 * Which type a scheduled shift was made from. A join row rather than a column
 * on `tasks`: the shift's times, head-count and people already live on the
 * task and its assignments, which is what the משימות board, the coverage
 * report and a person's page read, so the schedule and those screens cannot
 * disagree. What the task does not know is its kind of shift, and this row
 * says it.
 *
 * `task_id` cascades: a task that is gone has no slot. The type does not: a
 * retired type still names the slots that used it.
 */
export const shiftSlots = pgTable('shift_slots', {
  id: uuid('id').defaultRandom().primaryKey(),
  taskId: uuid('task_id').notNull().unique()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  shiftTypeId: uuid('shift_type_id').notNull()
    .references(() => shiftTypes.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WorkItemStatus = 'open' | 'done' | 'cancelled';

/**
 * A subject the logistics plan is organised under — ״סלון״, ״מטבח״,
 * ״שירותים״, ״מחנה״. Season-scoped: the camp decides each year what it is
 * building, and last year's list is a starting point a lead copies by hand,
 * not a fact that carries over on its own.
 *
 * `position` is the order a lead gave the list, 0-based; two topics with the
 * same position fall back to name order. No delete: a topic that is no
 * longer wanted is `archived_at` and keeps the items under it.
 */
export const workTopics = pgTable('work_topics', {
  id: uuid('id').defaultRandom().primaryKey(),
  seasonId: uuid('season_id').notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  notes: text('notes'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

/**
 * One thing the logistics plan has to get done, on a timeline.
 *
 * Two levels and no more: a general item (״להכין מכולת מטבח״) and the
 * smaller items under it (״לתקן מקררים״, ״לקנות מכולה״), each via
 * `parent_id`. A child cascades with its parent — a parent is never deleted
 * by this product, so the cascade is a safety net, not a verb.
 *
 * **Not a `tasks` row.** The camp's `tasks` table is one level deep and has
 * no dependencies, and it is a shared surface; the plan needs both and
 * belongs to logistics. The two are kept apart on purpose, and the screen
 * says so.
 *
 * The dates are `YYYY-MM-DD` text, civil days in the camp's zone, and both
 * are nullable: an item nobody has placed yet is listed as unscheduled, not
 * dropped, and never given a day it was not given. A start with no end is a
 * one-day item.
 *
 * `topic_id` is nullable: an item can sit under no topic (״כללי״) while a
 * lead is still sorting the list. `set null` on the topic: an archived or
 * removed topic leaves its items in the plan rather than taking them along.
 */
export const workItems = pgTable('work_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  seasonId: uuid('season_id').notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  topicId: uuid('topic_id')
    .references(() => workTopics.id, { onDelete: 'set null' }),
  parentId: uuid('parent_id')
    .references((): AnyPgColumn => workItems.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  notes: text('notes'),
  /** `2026-05-14`. Null is unscheduled. */
  startsOn: text('starts_on'),
  /** `2026-05-16`, inclusive. Null with a start means the one day. */
  endsOn: text('ends_on'),
  /** Who is responsible. A person on the roster, never free text. */
  assigneePersonId: uuid('assignee_person_id')
    .references(() => persons.id, { onDelete: 'set null' }),
  status: text('status').$type<WorkItemStatus>().notNull().default('open'),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

/**
 * ״X חייב להסתיים לפני Y״. One row per ordered pair; the library refuses a
 * pair that would close a cycle, because a plan that says A before B before
 * A can never be laid out and the screen would have to pick one silently.
 *
 * The dates are not enforced here. A dependency the dates contradict is a
 * visible decision on the timeline — the later item is marked, with the
 * sentence saying what it waits for — never a date the system moved.
 */
export const workDependencies = pgTable('work_dependencies', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** The item that has to be finished first. */
  beforeId: uuid('before_id').notNull()
    .references(() => workItems.id, { onDelete: 'cascade' }),
  /** The item that waits for it. */
  afterId: uuid('after_id').notNull()
    .references(() => workItems.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('work_dependencies_pair_key').on(table.beforeId, table.afterId),
]);
