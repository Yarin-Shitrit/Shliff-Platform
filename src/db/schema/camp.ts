import {
  pgTable, uuid, text, integer, timestamp, numeric, unique,
} from 'drizzle-orm/pg-core';

export type DueKind = 'flat' | 'exception';
export type TaskKind = 'deliverable' | 'shift' | 'build' | 'event_task';
export type TaskStatus = 'open' | 'done' | 'cancelled';
export type AssignmentStatus = 'proposed' | 'accepted' | 'done' | 'dropped';
export type EventKind = 'fundraiser' | 'burn';

/** Channels observed in the workbooks. `קיזוז` settles a due against a debt
 *  the camp owes the payer — the ברן 26 `יוסף קארינה יונתן ירין ועילאי 6,000`
 *  line is five such payments. */
export const PAYMENT_CHANNELS = [
  'מזומן', 'אשראי', 'ביט', 'פייבוקס', 'העברה', 'קיזוז',
] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

/**
 * A lasting human. Survives across burns. Deliberately shaped as a general
 * party record: when the ledger phase lands, suppliers and members must not
 * fork into two identity systems.
 */
export const persons = pgTable('persons', {
  id: uuid('id').defaultRandom().primaryKey(),
  displayName: text('display_name').notNull(),
  notes: text('notes'),
  /** Set when this person was merged into another. The row is kept rather than
   *  deleted so a merge can be undone and no alias ever disappears. */
  mergedIntoId: uuid('merged_into_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Every spelling of a name seen in a source sheet. `אופק` and `אופק כהן` are
 * two aliases of one person.
 *
 * `personId` is nullable on purpose: a name that import could not confidently
 * attribute is stored here unlinked, and appears in the leads' queue. That is
 * the whole "never auto-merge" mechanism — an unlinked name is visible and
 * costs a lead five seconds; a wrongly merged one silently combines two
 * people's dues, debts and ownerships.
 */
export const personAliases = pgTable('person_aliases', {
  id: uuid('id').defaultRandom().primaryKey(),
  personId: uuid('person_id').references(() => persons.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),
  /** `normalizeHebrew(alias)` — the form matching compares. */
  normalized: text('normalized').notNull(),
  /** manual | import */
  source: text('source').notNull(),
  /** Set when this alias moved here in a merge, naming the person it came
   *  from. It is what makes a merge exactly reversible without a log table. */
  mergedFromPersonId: uuid('merged_from_person_id'),
  confirmedBy: text('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
}, (table) => [
  // Deliberately NOT unique on `normalized` alone: two real people may share a
  // first name, and blocking that would force a wrong merge. Matching returns
  // every candidate and a lead decides.
  unique('person_aliases_person_normalized_key').on(table.personId, table.normalized),
]);

export const seasons = pgTable('seasons', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** `ברן 26` */
  name: text('name').notNull().unique(),
  year: integer('year').notNull(),
  /** Flat per-person dues. ברן 25: 1500.00, ברן 26: 1200.00. */
  flatRate: numeric('flat_rate', { precision: 12, scale: 2 }).notNull(),
  /** Camp size the budget assumes. ברן 25: 43, ברן 26: 35. */
  plannedSize: integer('planned_size'),
  startsOn: timestamp('starts_on', { withTimezone: true }),
});

export const memberships = pgTable('memberships', {
  id: uuid('id').defaultRandom().primaryKey(),
  personId: uuid('person_id').notNull()
    .references(() => persons.id, { onDelete: 'cascade' }),
  seasonId: uuid('season_id').notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  /** lead | member */
  role: text('role').notNull().default('member'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('memberships_person_season_key').on(table.personId, table.seasonId),
]);

/** One person's obligation for one season. */
export const dues = pgTable('dues', {
  id: uuid('id').defaultRandom().primaryKey(),
  personId: uuid('person_id').notNull()
    .references(() => persons.id, { onDelete: 'cascade' }),
  seasonId: uuid('season_id').notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  kind: text('kind').$type<DueKind>().notNull().default('flat'),
  /** Required when kind is 'exception'. `עמירם דהן 0` recorded with no reason
   *  and no decider is the failure this column exists to prevent. */
  exceptionReason: text('exception_reason'),
  decidedBy: text('decided_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('dues_person_season_key').on(table.personId, table.seasonId),
]);

/** Money actually received against a due. */
export const payments = pgTable('payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  dueId: uuid('due_id').notNull().references(() => dues.id, { onDelete: 'cascade' }),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  channel: text('channel').$type<PaymentChannel>().notNull(),
  paidOn: timestamp('paid_on', { withTimezone: true }).notNull(),
  /** Required when channel is 'קיזוז': what the payment was offset against. */
  note: text('note'),
  recordedBy: text('recorded_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A fundraising party, or the burn itself. Deliberately minimal this phase:
 *  it exists so tasks (and later, revenue) have something to hang off. */
export const campEvents = pgTable('camp_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  seasonId: uuid('season_id').notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind').$type<EventKind>().notNull(),
  heldOn: timestamp('held_on', { withTimezone: true }),
});

/**
 * Something that must be done, by someone, in some context. One table with a
 * `kind` rather than four tables: "everything אופק is responsible for" must be
 * one query, and uncovered-task reporting must span all four kinds at once.
 * The optional columns carry what only some kinds need.
 */
export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  seasonId: uuid('season_id').notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  eventId: uuid('event_id').references(() => campEvents.id, { onDelete: 'set null' }),
  kind: text('kind').$type<TaskKind>().notNull(),
  title: text('title').notNull(),
  description: text('description'),
  /** deliverable: the budget the owner is responsible for. */
  budgetAmount: numeric('budget_amount', { precision: 12, scale: 2 }),
  /** shift: the time window to staff. */
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  /** build: the deadline. */
  dueOn: timestamp('due_on', { withTimezone: true }),
  peopleNeeded: integer('people_needed').notNull().default(1),
  status: text('status').$type<TaskStatus>().notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const taskAssignments = pgTable('task_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull()
    .references(() => persons.id, { onDelete: 'cascade' }),
  status: text('status').$type<AssignmentStatus>().notNull().default('proposed'),
  assignedBy: text('assigned_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('task_assignments_task_person_key').on(table.taskId, table.personId),
]);
