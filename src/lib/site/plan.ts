import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import type { AnyDb } from '@/lib/db-types';
import { isBlank } from '@/lib/text/normalize';
import { seasons, tasks } from '@/db/schema/camp';
import { siteItems, siteKindDefaults, sitePlans, type SiteItemKind } from '@/db/schema/site';
import {
  DEFAULT_SHADE_INSET_CM, SITE_KINDS, isSiteItemKind,
} from './kinds';
import { placeNew } from './geometry';
import { derive, toPlaced, type ItemFlags, type SiteCounts } from './derive';
import type { KindDefaults } from './defaults';
import type { EditorDoc, EditorItem } from './editor/model';
import { lockRefusal, opRefusal, patchRefusal, type ItemPatch, type SiteOp } from './editor/ops';

/**
 * The camp map's reads and writes. One plan per season, any number of items
 * on it. Every refusal below is thrown in English for whoever reads a stack
 * trace; the Hebrew a lead sees is mapped at the action boundary by
 * `src/app/(admin)/site/failure-messages.ts` (R9, integration §5 A7). Each
 * message is a stable prefix that file keys on.
 */

/** Sides between one metre and half a kilometre. A plot outside that is a typo. */
const MIN_PLOT_CM = 100;
const MAX_PLOT_CM = 50_000;
const MIN_GRID_CM = 10;
const MAX_GRID_CM = 200;

export interface SitePlan {
  id: string;
  seasonId: string;
  widthCm: number;
  depthCm: number;
  gridCm: number;
  /** Bumped by every saved batch; the editor's guard against overwriting (spec §6.4). */
  version: number;
  /** The compass bearing of the map's "up"; 0 is north. */
  northDeg: number;
  notes: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface SiteItem {
  id: string;
  planId: string;
  kind: SiteItemKind;
  label: string;
  xCm: number;
  yCm: number;
  widthCm: number;
  depthCm: number;
  insetCm: number | null;
  heightCm: number | null;
  locked: boolean;
  sort: number;
  taskId: string | null;
  taskTitle: string | null;
  notes: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface PlotInput {
  widthCm: number;
  depthCm: number;
  gridCm: number;
  /** Whole degrees, 0–359. Left out, a new plan gets 0 and an existing one keeps its own. */
  northDeg?: number;
  notes?: string | null;
}

function validatePlot(input: PlotInput): void {
  for (const side of [input.widthCm, input.depthCm]) {
    if (!Number.isInteger(side) || side < MIN_PLOT_CM || side > MAX_PLOT_CM) {
      throw new Error('a plot side must be a whole number of centimetres between 100 and 50000');
    }
  }
  if (!Number.isInteger(input.gridCm) || input.gridCm < MIN_GRID_CM || input.gridCm > MAX_GRID_CM) {
    throw new Error('a grid step must be a whole number of centimetres between 10 and 200');
  }
  if (input.northDeg !== undefined
    && (!Number.isInteger(input.northDeg) || input.northDeg < 0 || input.northDeg > 359)) {
    throw new Error('north must be a whole number of degrees from 0 to 359');
  }
}

function cleanNotes(notes: string | null | undefined): string | null {
  return notes === null || notes === undefined || isBlank(notes) ? null : notes.trim();
}

export async function planForSeason(db: AnyDb, seasonId: string): Promise<SitePlan | null> {
  const [row] = await db.select().from(sitePlans)
    .where(eq(sitePlans.seasonId, seasonId)).limit(1);
  return (row as SitePlan | undefined) ?? null;
}

export async function planById(db: AnyDb, id: string): Promise<SitePlan | null> {
  const [row] = await db.select().from(sitePlans).where(eq(sitePlans.id, id)).limit(1);
  return (row as SitePlan | undefined) ?? null;
}

/** Returns the new plan's id. Refuses a second plan for the same season. */
export async function createPlan(
  db: AnyDb, seasonId: string, input: PlotInput, actor: string,
): Promise<string> {
  validatePlot(input);
  const [season] = await db.select({ id: seasons.id }).from(seasons)
    .where(eq(seasons.id, seasonId)).limit(1);
  if (!season) throw new Error(`unknown season ${seasonId}`);
  if (await planForSeason(db, seasonId)) {
    throw new Error('this season already has a map');
  }

  /* `.returning()` with no column list: `AnyDb` is a union of the Postgres and
     PGlite handles, and the projected form resolves to neither side's
     overload. Every other write in `src/lib` returns the whole row for the
     same reason. */
  const [row] = await db.insert(sitePlans)
    .values({
      seasonId,
      widthCm: input.widthCm,
      depthCm: input.depthCm,
      gridCm: input.gridCm,
      northDeg: input.northDeg ?? 0,
      notes: cleanNotes(input.notes),
      updatedBy: actor,
    })
    .returning();
  return row.id;
}

/**
 * Resizing the plot moves nothing. An item that the new fence now cuts
 * through is reported by `siteView` as outside — the lead decides whether the
 * tent moves or the fence does. Sliding it inside would be a guess about
 * which of its neighbours it should crowd.
 */
export async function setPlot(
  db: AnyDb, planId: string, input: PlotInput, actor: string,
): Promise<void> {
  validatePlot(input);
  if (!(await planById(db, planId))) throw new Error(`unknown site plan ${planId}`);

  await db.update(sitePlans)
    .set({
      widthCm: input.widthCm,
      depthCm: input.depthCm,
      gridCm: input.gridCm,
      ...(input.northDeg === undefined ? {} : { northDeg: input.northDeg }),
      notes: cleanNotes(input.notes),
      version: sql`${sitePlans.version} + 1`,
      updatedBy: actor,
      updatedAt: new Date(),
    })
    .where(eq(sitePlans.id, planId));
}

/**
 * Last year's map as this year's starting point: the plot size and every
 * item, at the same coordinates. The task links are not copied — a build
 * task belongs to one season, and the copy would point at last year's.
 *
 * Refuses when the target already has a map, so a copy can never silently
 * replace an afternoon's work.
 */
export async function copyPlan(
  db: AnyDb, fromSeasonId: string, toSeasonId: string, actor: string,
): Promise<string> {
  const source = await planForSeason(db, fromSeasonId);
  if (!source) throw new Error('that season has no map to copy');
  if (await planForSeason(db, toSeasonId)) throw new Error('this season already has a map');

  const planId = await createPlan(db, toSeasonId, {
    widthCm: source.widthCm, depthCm: source.depthCm, gridCm: source.gridCm,
    northDeg: source.northDeg, notes: source.notes,
  }, actor);

  const rows = await db.select().from(siteItems)
    .where(eq(siteItems.planId, source.id)).orderBy(asc(siteItems.sort), asc(siteItems.id));
  if (rows.length > 0) {
    await db.insert(siteItems).values(rows.map((row) => ({
      planId,
      kind: row.kind,
      label: row.label,
      xCm: row.xCm,
      yCm: row.yCm,
      widthCm: row.widthCm,
      depthCm: row.depthCm,
      insetCm: row.insetCm,
      heightCm: row.heightCm,
      sort: row.sort,
      notes: row.notes,
      updatedBy: actor,
    })));
  }
  return planId;
}

/** Every season that has a map, newest year first — what the copy drawer offers. */
export async function seasonsWithPlans(
  db: AnyDb,
): Promise<Array<{ seasonId: string; seasonName: string; items: number }>> {
  const plans = await db.select({
    seasonId: sitePlans.seasonId, seasonName: seasons.name, year: seasons.year, planId: sitePlans.id,
  })
    .from(sitePlans)
    .innerJoin(seasons, eq(seasons.id, sitePlans.seasonId))
    .orderBy(asc(seasons.year));
  const items = await db.select({ planId: siteItems.planId }).from(siteItems);
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.planId, (counts.get(item.planId) ?? 0) + 1);
  return plans.reverse().map((plan) => ({
    seasonId: plan.seasonId,
    seasonName: plan.seasonName,
    items: counts.get(plan.planId) ?? 0,
  }));
}

const ITEM_COLUMNS = {
  id: siteItems.id,
  planId: siteItems.planId,
  kind: siteItems.kind,
  label: siteItems.label,
  xCm: siteItems.xCm,
  yCm: siteItems.yCm,
  widthCm: siteItems.widthCm,
  depthCm: siteItems.depthCm,
  insetCm: siteItems.insetCm,
  heightCm: siteItems.heightCm,
  locked: siteItems.locked,
  sort: siteItems.sort,
  taskId: siteItems.taskId,
  taskTitle: tasks.title,
  notes: siteItems.notes,
  updatedAt: siteItems.updatedAt,
  updatedBy: siteItems.updatedBy,
};

export async function listItems(db: AnyDb, planId: string): Promise<SiteItem[]> {
  const rows = await db.select(ITEM_COLUMNS)
    .from(siteItems)
    .leftJoin(tasks, eq(tasks.id, siteItems.taskId))
    .where(eq(siteItems.planId, planId))
    // Draw order: what was placed first is drawn first, so a shade net
    // dropped first stays under the sofas dropped later.
    .orderBy(asc(siteItems.sort), asc(siteItems.id));
  return rows;
}

export async function itemById(db: AnyDb, id: string): Promise<SiteItem | null> {
  const [row] = await db.select(ITEM_COLUMNS)
    .from(siteItems)
    .leftJoin(tasks, eq(tasks.id, siteItems.taskId))
    .where(eq(siteItems.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Drops a preset onto the first free spot. Returns the new id so the board
 * can select what it just made. When the plot has no free spot the item
 * still lands — at the origin, on top of whatever is there — and the overlap
 * flag says so; refusing would leave the lead with nothing to drag.
 */
export async function addItem(
  db: AnyDb, planId: string, kind: SiteItemKind, actor: string,
): Promise<string> {
  if (!isSiteItemKind(kind)) throw new Error(`unknown item kind: ${kind}`);
  const plan = await planById(db, planId);
  if (!plan) throw new Error(`unknown site plan ${planId}`);

  const preset = SITE_KINDS[kind];
  const existing = await listItems(db, planId);
  const placed = existing.map(toPlaced);
  const spot = placeNew(placed, plan, { width: preset.widthCm, depth: preset.depthCm }, plan.gridCm, kind)
    ?? { x: 0, y: 0 };

  const [row] = await db.insert(siteItems)
    .values({
      planId,
      kind,
      label: nextLabel(preset.label, existing.filter((item) => item.kind === kind).length),
      xCm: spot.x,
      yCm: spot.y,
      widthCm: preset.widthCm,
      depthCm: preset.depthCm,
      insetCm: kind === 'shade' ? DEFAULT_SHADE_INSET_CM : null,
      // On top of everything drawn so far.
      sort: existing.reduce((top, item) => Math.max(top, item.sort), -1) + 1,
      updatedBy: actor,
    })
    .returning();
  return row.id;
}

/** `אוהל 4` — numbered by how many of its kind are already on the map, so two tents never share a name by default. */
function nextLabel(base: string, count: number): string {
  return `${base} ${count + 1}`;
}

export type { ItemPatch } from './editor/ops';

/** The one set of refusals the client also runs (`editor/ops.ts`). */
function validatePatch(patch: ItemPatch): void {
  const refusal = patchRefusal(patch);
  if (refusal !== null) throw new Error(refusal);
}

type ItemRow = typeof siteItems.$inferSelect;

/**
 * What a patch writes onto an existing row. A net keeps or gains an inset;
 * anything else never carries one — turning a sofa into a net gives it the
 * default rather than a null that would read as "shades its whole footprint".
 */
function patchSet(
  existing: Pick<ItemRow, 'kind' | 'insetCm'>, patch: ItemPatch, actor: string,
): Partial<typeof siteItems.$inferInsert> {
  const kind = patch.kind ?? existing.kind;
  const set: Partial<typeof siteItems.$inferInsert> = { updatedBy: actor, updatedAt: new Date() };
  if (patch.label !== undefined) set.label = patch.label.trim();
  if (patch.kind !== undefined) set.kind = patch.kind;
  if (patch.xCm !== undefined) set.xCm = patch.xCm;
  if (patch.yCm !== undefined) set.yCm = patch.yCm;
  if (patch.widthCm !== undefined) set.widthCm = patch.widthCm;
  if (patch.depthCm !== undefined) set.depthCm = patch.depthCm;
  if (patch.heightCm !== undefined) set.heightCm = patch.heightCm;
  if (patch.taskId !== undefined) set.taskId = patch.taskId;
  if (patch.notes !== undefined) set.notes = cleanNotes(patch.notes);
  if (patch.locked !== undefined) set.locked = patch.locked;
  if (kind === 'shade') {
    if (patch.insetCm !== undefined) set.insetCm = patch.insetCm ?? DEFAULT_SHADE_INSET_CM;
    else if (existing.insetCm === null) set.insetCm = DEFAULT_SHADE_INSET_CM;
  } else if (patch.kind !== undefined || patch.insetCm !== undefined) {
    set.insetCm = null;
  }
  return set;
}

async function assertBuildTask(db: AnyDb, taskId: string, seasonId: string): Promise<void> {
  const [task] = await db.select({ id: tasks.id }).from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.kind, 'build'), eq(tasks.seasonId, seasonId)))
    .limit(1);
  if (!task) throw new Error('that task is not a build task of this season');
}

/**
 * Partial on purpose: a drag sends two numbers, a handle sends four, the
 * drawer sends everything. One write path, one set of refusals.
 */
export async function updateItem(
  db: AnyDb, id: string, patch: ItemPatch, actor: string,
): Promise<void> {
  validatePatch(patch);
  const existing = await itemById(db, id);
  if (!existing) throw new Error(`unknown site item ${id}`);
  if (patch.taskId !== undefined && patch.taskId !== null) {
    const plan = await planById(db, existing.planId);
    await assertBuildTask(db, patch.taskId, plan?.seasonId ?? '');
  }
  await db.update(siteItems).set(patchSet(existing, patch, actor)).where(eq(siteItems.id, id));
}

/**
 * A real delete, unlike most of this platform. An item on the map is
 * somebody's statement that a thing goes there, not a fact about the world;
 * withdrawing the statement leaves nothing unexplained.
 */
export async function removeItem(db: AnyDb, id: string): Promise<void> {
  if (!(await itemById(db, id))) throw new Error(`unknown site item ${id}`);
  await db.delete(siteItems).where(eq(siteItems.id, id));
}

export type SiteItemView = SiteItem & ItemFlags;

export interface SiteView {
  plan: SitePlan;
  items: SiteItemView[];
  counts: SiteCounts;
}

/** One call for the whole screen: the plan, its items, and every derived flag. */
export async function siteView(db: AnyDb, seasonId: string): Promise<SiteView | null> {
  const plan = await planForSeason(db, seasonId);
  if (!plan) return null;
  const items = await listItems(db, plan.id);
  return deriveView(plan, items);
}

/** The same derivation the board runs in the browser (`derive.ts`), over the server's rows. */
export function deriveView(plan: SitePlan, items: readonly SiteItem[]): SiteView {
  return { plan, ...derive(plan, items) };
}

/** The camp's own sizes per kind (spec D4). A row for a kind the map no longer knows is ignored. */
export async function kindDefaults(db: AnyDb): Promise<KindDefaults> {
  const rows = await db.select().from(siteKindDefaults);
  const out: KindDefaults = {};
  for (const row of rows) {
    if (!isSiteItemKind(row.kind)) continue;
    out[row.kind] = { widthCm: row.widthCm, depthCm: row.depthCm, heightCm: row.heightCm, insetCm: row.insetCm };
  }
  return out;
}

export function toEditorItem(row: SiteItem): EditorItem {
  return {
    id: row.id, kind: row.kind, label: row.label,
    xCm: row.xCm, yCm: row.yCm, widthCm: row.widthCm, depthCm: row.depthCm,
    heightCm: row.heightCm, insetCm: row.insetCm, sort: row.sort,
    taskId: row.taskId, notes: row.notes, locked: row.locked,
  };
}

/** Everything the editor needs, and the version it will save against. */
export async function loadDoc(
  db: AnyDb, planId: string,
): Promise<{ doc: EditorDoc; version: number } | null> {
  const plan = await planById(db, planId);
  if (!plan) return null;
  const items = await listItems(db, planId);
  const defaults = await kindDefaults(db);
  return {
    version: plan.version,
    doc: {
      plot: { id: plan.id, widthCm: plan.widthCm, depthCm: plan.depthCm, gridCm: plan.gridCm, northDeg: plan.northDeg },
      items: items.map(toEditorItem),
      defaults,
    },
  };
}

/**
 * Runs `fn` in one transaction whichever driver `db` is — the same bridge as
 * `src/lib/import/run-import.ts`, which explains the cast.
 */
async function inTransaction<T>(db: AnyDb, fn: (tx: AnyDb) => Promise<T>): Promise<T> {
  return (db as Db).transaction((tx) => fn(tx as unknown as AnyDb));
}

export type ApplyResult =
  | { status: 'saved'; version: number }
  | { status: 'conflict'; version: number };

/**
 * One batch of the editor's edits, applied whole or not at all (spec §6.4).
 *
 * The plan row is locked and its version compared first: a mismatch means
 * another lead saved in between, and the answer is the current version with
 * nothing written — the editor turns that into a decision on screen. Every
 * op is checked with the same refusals the client ran, plus what only the
 * database can know: the item is on this plan, the id is free, the task is a
 * build task of this season, the item is not locked.
 */
export async function applySiteOps(
  db: AnyDb, planId: string, baseVersion: number, ops: readonly SiteOp[], actor: string,
): Promise<ApplyResult> {
  for (const op of ops) {
    const refusal = opRefusal(op);
    if (refusal !== null) throw new Error(refusal);
  }

  return inTransaction(db, async (tx) => {
    const [plan] = await tx.select({ id: sitePlans.id, version: sitePlans.version, seasonId: sitePlans.seasonId })
      .from(sitePlans).where(eq(sitePlans.id, planId)).limit(1).for('update');
    if (!plan) throw new Error(`unknown site plan ${planId}`);
    if (plan.version !== baseVersion) return { status: 'conflict', version: plan.version };
    if (ops.length === 0) return { status: 'saved', version: plan.version };

    const rows = await tx.select().from(siteItems).where(eq(siteItems.planId, planId));
    const byId = new Map(rows.map((row) => [row.id, row]));

    for (const op of ops) {
      if (op.type === 'add') {
        const [taken] = await tx.select({ id: siteItems.id }).from(siteItems)
          .where(eq(siteItems.id, op.item.id)).limit(1);
        if (taken) throw new Error('an item id is already in use');
        if (op.item.taskId !== null) await assertBuildTask(tx, op.item.taskId, plan.seasonId);
        const entry = op.item;
        const [row] = await tx.insert(siteItems).values({
          id: entry.id, planId, kind: entry.kind, label: entry.label.trim(),
          xCm: entry.xCm, yCm: entry.yCm, widthCm: entry.widthCm, depthCm: entry.depthCm,
          heightCm: entry.heightCm,
          insetCm: entry.kind === 'shade' ? (entry.insetCm ?? DEFAULT_SHADE_INSET_CM) : null,
          // The client owns draw order (spec §6.2): what it sent is what is drawn.
          sort: entry.sort, taskId: entry.taskId, notes: cleanNotes(entry.notes), locked: entry.locked,
          updatedBy: actor,
        }).returning();
        byId.set(row.id, row);
      } else if (op.type === 'update') {
        const existing = byId.get(op.id);
        if (!existing) throw new Error(`unknown site item ${op.id}`);
        const locked = lockRefusal(existing.locked, op.patch);
        if (locked !== null) throw new Error(locked);
        if (op.patch.taskId !== undefined && op.patch.taskId !== null) {
          await assertBuildTask(tx, op.patch.taskId, plan.seasonId);
        }
        const set = patchSet(existing, op.patch, actor);
        await tx.update(siteItems).set(set).where(eq(siteItems.id, op.id));
        byId.set(op.id, { ...existing, ...set } as ItemRow);
      } else if (op.type === 'remove') {
        const existing = byId.get(op.id);
        if (!existing) throw new Error(`unknown site item ${op.id}`);
        if (existing.locked) throw new Error('that item is locked');
        await tx.delete(siteItems).where(eq(siteItems.id, op.id));
        byId.delete(op.id);
      } else if (op.size === null) {
        await tx.delete(siteKindDefaults).where(eq(siteKindDefaults.kind, op.kind));
      } else {
        // Inset is a fact about nets only, same as an item's (`patchSet` above).
        const size = {
          widthCm: op.size.widthCm, depthCm: op.size.depthCm, heightCm: op.size.heightCm,
          insetCm: op.kind === 'shade' ? op.size.insetCm : null,
        };
        await tx.insert(siteKindDefaults).values({ kind: op.kind, ...size, updatedBy: actor })
          .onConflictDoUpdate({ target: siteKindDefaults.kind, set: { ...size, updatedAt: new Date(), updatedBy: actor } });
      }
    }

    const version = plan.version + 1;
    await tx.update(sitePlans).set({ version, updatedAt: new Date(), updatedBy: actor })
      .where(eq(sitePlans.id, planId));
    return { status: 'saved', version };
  });
}
