import {
  pgTable, uuid, text, integer, timestamp, numeric, boolean, unique,
} from 'drizzle-orm/pg-core';
import {
  persons, seasons, campEvents, payments,
} from './camp';
import { blocks } from './source';

export type AccountKind = 'cash' | 'bank' | 'personal' | 'event_float';
export type LedgerDirection = 'in' | 'out';
export type ObligationDirection = 'camp_owes' | 'owed_to_camp';
export type SettlementKind = 'cash' | 'offset';
export type BudgetCategory = 'camp' | 'dancefloor';

/**
 * Where money physically sits. `עו״ש אופק` is a member's *personal* current
 * account holding camp funds — `holderPersonId` says so out loud rather than
 * pretending the camp has one קופה.
 *
 * There is deliberately no `balance` column. A balance is `openingBalance`
 * plus movements in, minus movements out, and a stored copy would be a second
 * truth that drifts.
 */
export const accounts = pgTable('accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  kind: text('kind').$type<AccountKind>().notNull(),
  holderPersonId: uuid('holder_person_id')
    .references(() => persons.id, { onDelete: 'set null' }),
  /** What the ledger cannot derive, because the earlier book is not loaded. */
  openingBalance: numeric('opening_balance', { precision: 12, scale: 2 })
    .notNull().default('0.00'),
  openingOn: timestamp('opening_on', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

/**
 * One movement of money that is not a dues payment. Dues payments live in
 * `payments` and carry their own `accountId`; the two are read together by
 * `listMovements` and never copied into each other.
 *
 * `seasonId` is nullable and set by hand, never inferred from `occurredOn`:
 * `חוב לירון סלע על ברן 25 — 14,000` is dated June 2026 and belongs to ברן 25.
 */
export const ledgerEntries = pgTable('ledger_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  occurredOn: timestamp('occurred_on', { withTimezone: true }).notNull(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  direction: text('direction').$type<LedgerDirection>().notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  description: text('description').notNull(),
  seasonId: uuid('season_id').references(() => seasons.id, { onDelete: 'set null' }),
  eventId: uuid('event_id').references(() => campEvents.id, { onDelete: 'set null' }),
  budgetLineId: uuid('budget_line_id')
    .references(() => budgetLines.id, { onDelete: 'set null' }),
  /** Two entries sharing this id are one transfer between accounts. */
  transferGroupId: uuid('transfer_group_id'),
  recordedBy: text('recorded_by').notNull(),
  sourceBlockId: uuid('source_block_id').references(() => blocks.id, { onDelete: 'set null' }),
  sourceRow: integer('source_row'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('ledger_entries_source_key').on(table.sourceBlockId, table.sourceRow),
]);

/**
 * One planned expense for a season.
 *
 * `quantityText` is the truth: the workbook's quantity column holds `12,000kw`,
 * `מכולה`, `תפריט שלם לשבוע` and `מקרר תעשייתי` beside plain numbers, and
 * storing it numeric would destroy it. `quantityNum` exists only so that
 * `quantity × unit ≠ total` stays checkable.
 */
export const budgetLines = pgTable('budget_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  seasonId: uuid('season_id').notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  quantityText: text('quantity_text'),
  quantityNum: numeric('quantity_num', { precision: 12, scale: 2 }),
  unitCost: numeric('unit_cost', { precision: 12, scale: 2 }),
  total: numeric('total', { precision: 12, scale: 2 }).notNull(),
  /** The workbook's `why` column: `תוספת של 1,000 שקלים - לחיזוק`. */
  rationale: text('rationale'),
  category: text('category').$type<BudgetCategory>().notNull().default('camp'),
  sourceBlockId: uuid('source_block_id').references(() => blocks.id, { onDelete: 'set null' }),
  sourceRow: integer('source_row'),
}, (table) => [
  unique('budget_lines_source_key').on(table.sourceBlockId, table.sourceRow),
]);

/** One line of the year's fundraising plan — `הורדת מחיר דמי קאמפ 22,375.3`. */
export const fundingTargets = pgTable('funding_targets', {
  id: uuid('id').defaultRandom().primaryKey(),
  seasonId: uuid('season_id').notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  note: text('note'),
  /**
   * Whether this target is part of what the camp budget assumes will be
   * raised, rather than part of the year's wider fundraising.
   *
   * `הורדת מחיר דמי קאמפ 22,375.3` is the only ברן 26 line that is: it is what
   * keeps dues at 1,200 instead of 1,839.29. `הגברה`, `ארט קאר` and the rest
   * fund the dancefloor and the year, and counting them against the camp
   * budget would compare two different things.
   */
  countsTowardCampBudget: boolean('counts_toward_camp_budget').notNull().default(false),
  sourceBlockId: uuid('source_block_id').references(() => blocks.id, { onDelete: 'set null' }),
  sourceRow: integer('source_row'),
}, (table) => [
  unique('funding_targets_source_key').on(table.sourceBlockId, table.sourceRow),
]);

/** Planned or sold ticket revenue — `סבב ג׳ 165 × 200`. */
export const ticketRounds = pgTable('ticket_rounds', {
  id: uuid('id').defaultRandom().primaryKey(),
  seasonId: uuid('season_id').notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  eventId: uuid('event_id').references(() => campEvents.id, { onDelete: 'set null' }),
  label: text('label').notNull(),
  quantity: integer('quantity'),
  price: numeric('price', { precision: 12, scale: 2 }),
  total: numeric('total', { precision: 12, scale: 2 }).notNull(),
  sold: boolean('sold').notNull().default(false),
  sourceBlockId: uuid('source_block_id').references(() => blocks.id, { onDelete: 'set null' }),
  sourceRow: integer('source_row'),
}, (table) => [
  unique('ticket_rounds_source_key').on(table.sourceBlockId, table.sourceRow),
]);

/**
 * A debt in either direction. `חוב יוסף 15,240` and `אורי 300` are the same
 * fact at different sizes.
 *
 * Both party columns are nullable on purpose. `שולם 500 — מקפיא באיחסון נוסף`
 * genuinely records no name, and the system must keep that row rather than
 * drop it or invent an owner. An obligation with no party can never be marked
 * settled — see `settleObligation`.
 */
export const obligations = pgTable('obligations', {
  id: uuid('id').defaultRandom().primaryKey(),
  direction: text('direction').$type<ObligationDirection>().notNull(),
  partyPersonId: uuid('party_person_id')
    .references(() => persons.id, { onDelete: 'set null' }),
  /** The raw string when the source names someone but no confident link exists. */
  partyName: text('party_name'),
  description: text('description').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  seasonId: uuid('season_id').references(() => seasons.id, { onDelete: 'set null' }),
  openedOn: timestamp('opened_on', { withTimezone: true }).notNull().defaultNow(),
  sourceBlockId: uuid('source_block_id').references(() => blocks.id, { onDelete: 'set null' }),
  sourceRow: integer('source_row'),
}, (table) => [
  unique('obligations_source_key').on(table.sourceBlockId, table.sourceRow),
]);

/**
 * How an obligation gets discharged. This is the join that has never existed:
 * `חוב יוסף` → a 6,000 offset → five ברן 26 dues, instead of five payments
 * sharing a free-text note.
 */
export const obligationSettlements = pgTable('obligation_settlements', {
  id: uuid('id').defaultRandom().primaryKey(),
  obligationId: uuid('obligation_id').notNull()
    .references(() => obligations.id, { onDelete: 'cascade' }),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  kind: text('kind').$type<SettlementKind>().notNull(),
  ledgerEntryId: uuid('ledger_entry_id')
    .references(() => ledgerEntries.id, { onDelete: 'set null' }),
  /** Set when this settlement was an offset against a member's dues. */
  paymentId: uuid('payment_id')
    .references(() => payments.id, { onDelete: 'set null' }),
  note: text('note'),
  settledOn: timestamp('settled_on', { withTimezone: true }).notNull(),
  recordedBy: text('recorded_by').notNull(),
});
