import {
  pgTable, uuid, text, integer, timestamp, jsonb, numeric, unique,
} from 'drizzle-orm/pg-core';
import type { ColumnMapping } from '@/lib/classify/map-columns';
import type { BlockArchetype } from '@/lib/classify/types';

export const uploads = pgTable('uploads', {
  id: uuid('id').defaultRandom().primaryKey(),
  filename: text('filename').notNull(),
  /** Hex SHA-256 of the file bytes; makes re-uploading the same file a no-op. */
  sha256: text('sha256').notNull().unique(),
  /** Key in the private blob store. */
  storageKey: text('storage_key').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  uploadedBy: text('uploaded_by').notNull(),
  /** pending → parsed → committed, or failed. */
  status: text('status').notNull().default('pending'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sheets = pgTable('sheets', {
  id: uuid('id').defaultRandom().primaryKey(),
  uploadId: uuid('upload_id').notNull()
    .references(() => uploads.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  index: integer('index').notNull(),
  rowCount: integer('row_count').notNull(),
  colCount: integer('col_count').notNull(),
});

export const blocks = pgTable('blocks', {
  id: uuid('id').defaultRandom().primaryKey(),
  sheetId: uuid('sheet_id').notNull()
    .references(() => sheets.id, { onDelete: 'cascade' }),
  /** Inclusive 1-indexed bounds within the sheet. */
  top: integer('top').notNull(),
  left: integer('left').notNull(),
  bottom: integer('bottom').notNull(),
  right: integer('right').notNull(),
  archetype: text('archetype').$type<BlockArchetype>().notNull(),
  confidence: numeric('confidence').notNull(),
  headerRow: integer('header_row'),
  /** Layout fingerprint, when a header row was found. */
  fingerprint: text('fingerprint'),
  pipelineVersion: integer('pipeline_version').notNull(),
  /** The block's cells exactly as they appeared, for review and re-parsing. */
  rawGrid: jsonb('raw_grid').$type<string[][]>().notNull(),
  confirmedBy: text('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
});

export const blockMappings = pgTable('block_mappings', {
  id: uuid('id').defaultRandom().primaryKey(),
  blockId: uuid('block_id').notNull()
    .references(() => blocks.id, { onDelete: 'cascade' }),
  columnMap: jsonb('column_map').$type<ColumnMapping[]>().notNull(),
  /** rules | signature | admin — where this mapping came from. */
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('block_mappings_block_id_key').on(table.blockId),
]);

export const layoutSignatures = pgTable('layout_signatures', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** 32-char hex from layoutFingerprint. */
  fingerprint: text('fingerprint').notNull().unique(),
  archetype: text('archetype').$type<BlockArchetype>().notNull(),
  columnMap: jsonb('column_map').$type<ColumnMapping[]>().notNull(),
  pipelineVersion: integer('pipeline_version').notNull(),
  confirmedBy: text('confirmed_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
