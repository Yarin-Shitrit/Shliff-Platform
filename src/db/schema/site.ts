import {
  pgTable, uuid, text, integer, timestamp, unique, boolean, jsonb,
} from 'drizzle-orm/pg-core';
import { seasons, tasks } from './camp';

/**
 * What can be drawn on the camp map. The presets (default size, colour
 * group, Hebrew label) live in `src/lib/site/kinds.ts`; this is only the
 * closed set the column accepts. `other` is the free-form one — a lead types
 * its label — so a thing the list never thought of can still be drawn rather
 * than forced into the nearest wrong box.
 *
 * `sink` and `light` came with the utility lines (migration `0013`): a sink
 * is where a water pipe ends, a light is where a power cable ends, and until
 * they were kinds of their own a pipe had nothing to be drawn to.
 */
export type SiteItemKind =
  | 'tent' | 'caravan' | 'shade'
  | 'kitchen' | 'bar' | 'sofa' | 'armchair' | 'table' | 'fire'
  | 'shower' | 'toilet' | 'changing' | 'sink'
  | 'fridge' | 'generator' | 'water' | 'greywater' | 'boiler' | 'storage' | 'light'
  | 'other';

/**
 * What runs along the ground between two items: a water pipe or a power
 * cable. The rules of which kinds each may join live in
 * `src/lib/site/lines.ts`; this is only the closed set the column accepts.
 */
export type SiteLineKind = 'water' | 'power';

/** A bend in a line, as whole centimetres on the map: `[xCm, yCm]`. */
export type SiteLinePoint = [number, number];

/**
 * The plot one season builds on. One per season, because the plot changes
 * every burn — a different corner of the playa, a different allocation — and
 * a map drawn for one is only a starting point for the next. "Copy from last
 * year" creates the new row from the old one and the lead edits from there.
 *
 * **Every length is an integer number of centimetres.** A metre grid with
 * half-metre snapping is integer arithmetic in centimetres and floating-point
 * arithmetic in metres; a tent dragged twenty times must land on the same
 * grid line it started on, which `0.1 + 0.2` cannot promise.
 *
 * `gridCm` is the snap step the board drags on. It is stored with the plan so
 * two leads on two machines snap to the same lines.
 */
export const sitePlans = pgTable('site_plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  seasonId: uuid('season_id').notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  widthCm: integer('width_cm').notNull(),
  depthCm: integer('depth_cm').notNull(),
  gridCm: integer('grid_cm').notNull().default(50),
  /**
   * Bumped by every saved batch of edits (`applySiteOps`). The editor sends
   * the version it loaded; a mismatch means another lead saved in between,
   * and that becomes a visible decision rather than an overwrite (spec §6.4).
   */
  version: integer('version').notNull().default(0),
  /**
   * The compass bearing the map's "up" points to, in whole degrees. 0 is
   * north, which is what the map has always implied. Read by shade by hour
   * (spec §11), by the view controls' compass, whose needle points to true
   * north, and by `northUp`, which turns the view so true north is up
   * (spec §6); the plot inspector and the sun card say it in words.
   */
  northDeg: integer('north_deg').notNull().default(0),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
}, (table) => [
  unique('site_plans_season_key').on(table.seasonId),
]);

/**
 * One thing on the map: a tent, a caravan, the kitchen, a sofa, a shade net.
 *
 * **No rotation column.** A "turn" swaps `widthCm` and `depthCm`, so every
 * rectangle stays axis-aligned and "does this overlap that" and "is this
 * inside the plot" are four comparisons each, which is what makes them
 * cheap enough to compute on every drag and simple enough to test by hand.
 *
 * `insetCm` is for a shade net only: the strip on every side that the net
 * does *not* shade. An 8 × 8 net with 50 cm of inset shades 7 × 7. The
 * footprint stays the full 8 × 8 — the ground under the edge is still usable
 * — and the board tells the lead what sits in the strip. Null on everything
 * that is not a net.
 *
 * `sort` is draw order: lower is drawn first, so a shade net at 0 sits under
 * the sofas at 1, 2, 3. It is explicit rather than `created_at` because a
 * copied map inserts every row in one statement, at one timestamp, and the
 * order the lead built up would otherwise be lost in the copy.
 *
 * `taskId` links a structure to the build task that raises it, and sets null
 * rather than cascading: the tent is still on the map after somebody deletes
 * the task, only the link is gone. The reverse — deleting the plan — takes
 * its items with it, because an item has no meaning off its plan.
 */
export const siteItems = pgTable('site_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  planId: uuid('plan_id').notNull()
    .references(() => sitePlans.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<SiteItemKind>().notNull().default('other'),
  label: text('label').notNull(),
  xCm: integer('x_cm').notNull(),
  yCm: integer('y_cm').notNull(),
  widthCm: integer('width_cm').notNull(),
  depthCm: integer('depth_cm').notNull(),
  insetCm: integer('inset_cm'),
  /**
   * Null means the kind's height (`kinds.ts`, or the camp's default for the
   * kind). Drawn and shadowed, never validated against anything.
   */
  heightCm: integer('height_cm'),
  /** A locked item is not dragged, nudged, resized, turned or removed until it is unlocked. */
  locked: boolean('locked').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

/**
 * The camp's own size for a kind, overriding the preset in `kinds.ts`. One
 * row per kind, camp-wide (spec D4): a tent's size is a fact about the camp's
 * equipment and survives from one burn to the next. No row means the preset;
 * "back to the standard size" deletes the row.
 */
export const siteKindDefaults = pgTable('site_kind_defaults', {
  kind: text('kind').$type<SiteItemKind>().primaryKey(),
  widthCm: integer('width_cm').notNull(),
  depthCm: integer('depth_cm').notNull(),
  heightCm: integer('height_cm').notNull(),
  insetCm: integer('inset_cm'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

/**
 * A pipe or a cable on the map (migration `0013`): what the camp has to buy
 * by the metre. It runs from one item to another — a drinking-water tank to
 * a shower, the generator to a fridge — and the map measures how long it is.
 *
 * The two ends are items, not points, so a line follows its fridge when the
 * fridge is dragged, and the length on screen is always the length between
 * where the things actually stand. `points_cm` holds the bends between the
 * ends, in order, as whole centimetres; an empty list is a straight run.
 * The ends themselves are never stored here — they are the items'.
 *
 * Deleting an end deletes the line: a cable to nowhere measures nothing. The
 * editor removes a line with its item explicitly, so an undo brings both
 * back; the cascade is the database's own guarantee for everything else.
 *
 * `sort` is the order the lines were drawn in, kept so a copied map keeps
 * it; nothing is drawn over a line, so it is not draw order.
 */
export const siteLines = pgTable('site_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  planId: uuid('plan_id').notNull()
    .references(() => sitePlans.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<SiteLineKind>().notNull(),
  label: text('label').notNull(),
  fromItemId: uuid('from_item_id').notNull()
    .references(() => siteItems.id, { onDelete: 'cascade' }),
  toItemId: uuid('to_item_id').notNull()
    .references(() => siteItems.id, { onDelete: 'cascade' }),
  pointsCm: jsonb('points_cm').$type<SiteLinePoint[]>().notNull().default([]),
  sort: integer('sort').notNull().default(0),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});
