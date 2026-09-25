import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import type { AnyDb } from '@/lib/db-types';
import { isBlank } from '@/lib/text/normalize';
import { seasons, tasks } from '@/db/schema/camp';
import {
  siteItems, siteKindDefaults, siteLines, sitePlans, type SiteItemKind, type SiteLineKind, type SiteLinePoint,
} from '@/db/schema/site';
import { DEFAULT_SHADE_INSET_CM, isSiteItemKind } from './kinds';
import { derive, type ItemFlags, type SiteCounts } from './derive';
import type { KindDefaults } from './defaults';
import type { EditorDoc, EditorItem, EditorLine } from './editor/model';
import {
  isLineOp, lineEndsRefusal, lockRefusal, opRefusal, rekindRefusal, storedLinePatch, storedPatch,
  type ItemPatch, type LinePatch, type SiteOp,
} from './editor/ops';
import { lineLengthCm } from './lines';

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

/** A pipe or a cable as the database holds it, with its length on this map worked out on read. */
export interface SiteLine {
  id: string;
  planId: string;
  kind: SiteLineKind;
  label: string;
  fromItemId: string;
  toItemId: string;
  pointsCm: SiteLinePoint[];
  sort: number;
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
/** Saves the plot and bumps the plan's version; answers the new version, so an editor can tell its own plot save from another lead's. */
export async function setPlot(
  db: AnyDb, planId: string, input: PlotInput, actor: string,
): Promise<number> {
  validatePlot(input);
  if (!(await planById(db, planId))) throw new Error(`unknown site plan ${planId}`);

  const [row] = await db.update(sitePlans)
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
    .where(eq(sitePlans.id, planId))
    .returning();
  return row.version;
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
    // New ids for the copies, remembered so the copied lines run between the copies.
    const copies = rows.map((row) => ({
      id: crypto.randomUUID(),
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
    }));
    await db.insert(siteItems).values(copies);
    const copyOf = new Map(rows.map((row, index) => [row.id, copies[index].id]));

    // The pipes and cables run between the same things next year: copied, re-pointed at the copies.
    const lines = await db.select().from(siteLines)
      .where(eq(siteLines.planId, source.id)).orderBy(asc(siteLines.sort), asc(siteLines.id));
    const carried = lines.flatMap((line) => {
      const fromItemId = copyOf.get(line.fromItemId);
      const toItemId = copyOf.get(line.toItemId);
      if (fromItemId === undefined || toItemId === undefined) return [];
      return [{
        planId, kind: line.kind, label: line.label, fromItemId, toItemId,
        pointsCm: line.pointsCm.map((p): SiteLinePoint => [p[0], p[1]]),
        sort: line.sort, notes: line.notes, updatedBy: actor,
      }];
    });
    if (carried.length > 0) await db.insert(siteLines).values(carried);
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

const LINE_COLUMNS = {
  id: siteLines.id,
  planId: siteLines.planId,
  kind: siteLines.kind,
  label: siteLines.label,
  fromItemId: siteLines.fromItemId,
  toItemId: siteLines.toItemId,
  pointsCm: siteLines.pointsCm,
  sort: siteLines.sort,
  notes: siteLines.notes,
  updatedAt: siteLines.updatedAt,
  updatedBy: siteLines.updatedBy,
};

/** The plan's pipes and cables, in the order they were drawn. */
export async function listLines(db: AnyDb, planId: string): Promise<SiteLine[]> {
  return db.select(LINE_COLUMNS)
    .from(siteLines)
    .where(eq(siteLines.planId, planId))
    .orderBy(asc(siteLines.sort), asc(siteLines.id));
}

export function toEditorLine(row: SiteLine): EditorLine {
  return {
    id: row.id, kind: row.kind, label: row.label, fromId: row.fromItemId, toId: row.toItemId,
    points: row.pointsCm.map((p): SiteLinePoint => [p[0], p[1]]), sort: row.sort, notes: row.notes,
  };
}

/** A line with its length on this map and the names of its ends — what the item table prints. */
export type SiteLineView = SiteLine & {
  fromLabel: string;
  toLabel: string;
  /** Null when an end is not on this map, which the cascade should make impossible; the table then says so rather than printing 0. */
  lengthCm: number | null;
};

/*
 * Items are written only by `applySiteOps` below: a batch against the version
 * it read, refusing a locked item. The board's own writes — `addItem`,
 * `updateItem`, `removeItem` — bumped no version and ignored locks, so a board
 * edit and an editor edit could overwrite each other silently (final review,
 * C1). They retired with the board (Task 26).
 */

type ItemRow = typeof siteItems.$inferSelect;

/**
 * What a patch writes onto an existing row. `storedPatch` (`editor/ops.ts`,
 * the one set of rules the client also runs) shapes the patch — trims the
 * label, clears blank notes, decides the inset — and this copies its fields
 * into the drizzle set.
 */
function patchSet(
  existing: Pick<ItemRow, 'kind' | 'insetCm'>, patch: ItemPatch, actor: string,
): Partial<typeof siteItems.$inferInsert> {
  const stored = storedPatch(existing, patch);
  const set: Partial<typeof siteItems.$inferInsert> = { updatedBy: actor, updatedAt: new Date() };
  if (stored.label !== undefined) set.label = stored.label;
  if (stored.kind !== undefined) set.kind = stored.kind;
  if (stored.xCm !== undefined) set.xCm = stored.xCm;
  if (stored.yCm !== undefined) set.yCm = stored.yCm;
  if (stored.widthCm !== undefined) set.widthCm = stored.widthCm;
  if (stored.depthCm !== undefined) set.depthCm = stored.depthCm;
  if (stored.heightCm !== undefined) set.heightCm = stored.heightCm;
  if (stored.taskId !== undefined) set.taskId = stored.taskId;
  if (stored.notes !== undefined) set.notes = stored.notes;
  if (stored.locked !== undefined) set.locked = stored.locked;
  if (stored.insetCm !== undefined) set.insetCm = stored.insetCm;
  return set;
}

/** What a line patch writes onto its row, once `storedLinePatch` has shaped it. */
function lineSet(stored: LinePatch, actor: string): Partial<typeof siteLines.$inferInsert> {
  const set: Partial<typeof siteLines.$inferInsert> = { updatedBy: actor, updatedAt: new Date() };
  if (stored.label !== undefined) set.label = stored.label;
  if (stored.fromId !== undefined) set.fromItemId = stored.fromId;
  if (stored.toId !== undefined) set.toItemId = stored.toId;
  if (stored.points !== undefined) set.pointsCm = stored.points;
  if (stored.notes !== undefined) set.notes = stored.notes;
  return set;
}

async function assertBuildTask(db: AnyDb, taskId: string, seasonId: string): Promise<void> {
  const [task] = await db.select({ id: tasks.id }).from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.kind, 'build'), eq(tasks.seasonId, seasonId)))
    .limit(1);
  if (!task) throw new Error('that task is not a build task of this season');
}

export type SiteItemView = SiteItem & ItemFlags;

export interface SiteView {
  plan: SitePlan;
  items: SiteItemView[];
  lines: SiteLineView[];
  counts: SiteCounts;
}

/** One call for the whole screen: the plan, its items, its lines, and every derived flag. */
export async function siteView(db: AnyDb, seasonId: string): Promise<SiteView | null> {
  const plan = await planForSeason(db, seasonId);
  if (!plan) return null;
  const items = await listItems(db, plan.id);
  const lines = await listLines(db, plan.id);
  return deriveView(plan, items, lines);
}

/** The same derivation the editor's store runs in the browser (`derive.ts`, `lines.ts`), over the server's rows. */
export function deriveView(plan: SitePlan, items: readonly SiteItem[], lines: readonly SiteLine[] = []): SiteView {
  const doc: EditorDoc = {
    plot: { id: plan.id, widthCm: plan.widthCm, depthCm: plan.depthCm, gridCm: plan.gridCm, northDeg: plan.northDeg },
    items: items.map(toEditorItem),
    lines: lines.map(toEditorLine),
    defaults: {},
  };
  const labelOf = (id: string) => items.find((item) => item.id === id)?.label ?? '';
  return {
    plan,
    ...derive(plan, items),
    lines: lines.map((line) => ({
      ...line,
      fromLabel: labelOf(line.fromItemId),
      toLabel: labelOf(line.toItemId),
      lengthCm: lineLengthCm(doc, toEditorLine(line)),
    })),
  };
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
  const lines = await listLines(db, planId);
  const defaults = await kindDefaults(db);
  return {
    version: plan.version,
    doc: {
      plot: { id: plan.id, widthCm: plan.widthCm, depthCm: plan.depthCm, gridCm: plan.gridCm, northDeg: plan.northDeg },
      items: items.map(toEditorItem),
      lines: lines.map(toEditorLine),
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
  /** `skipped`: the ids of updates and removals naming an item this plan does not have (gone, or never here). */
  | { status: 'saved'; version: number; skipped: string[] }
  | { status: 'conflict'; version: number };

/**
 * One batch of the editor's edits, applied whole or not at all (spec §6.4).
 *
 * The plan row is locked and its version compared first: a mismatch means
 * another lead saved in between, and the answer is the current version with
 * nothing written — the editor turns that into a decision on screen. Every
 * op is checked with the same refusals the client ran, plus what only the
 * database can know: the id is free, the task is a build task of this
 * season, the item is not locked.
 *
 * An update or a removal naming an item this plan does not have — another
 * lead removed it, or it was never here — is skipped and reported in
 * `skipped`, the rule `applyOps` keeps on the client, rather than refusing the
 * whole batch: a refusal would be resent unchanged forever (review C2), and
 * there is nothing left to change. A batch that wrote nothing keeps the
 * version, as an empty one does.
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
    if (ops.length === 0) return { status: 'saved', version: plan.version, skipped: [] };

    const rows = await tx.select().from(siteItems).where(eq(siteItems.planId, planId));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const lineRows = await tx.select().from(siteLines).where(eq(siteLines.planId, planId));
    const linesById = new Map(lineRows.map((row) => [row.id, row]));
    const linesAt = (itemId: string) => [...linesById.values()].filter((line) => line.fromItemId === itemId || line.toItemId === itemId);
    const endOf = (id: string) => {
      const row = byId.get(id);
      return row === undefined ? undefined : { id: row.id, kind: row.kind };
    };

    const skipped: string[] = [];

    for (const op of ops) {
      if (isLineOp(op)) {
        if (op.type === 'addLine') {
          const [taken] = await tx.select({ id: siteLines.id }).from(siteLines)
            .where(eq(siteLines.id, op.line.id)).limit(1);
          if (taken) throw new Error('a line id is already in use');
          const ends = lineEndsRefusal(op.line.kind, endOf(op.line.fromId), endOf(op.line.toId));
          if (ends !== null) throw new Error(ends);
          const entry = op.line;
          const [row] = await tx.insert(siteLines).values({
            id: entry.id, planId, kind: entry.kind, label: entry.label.trim(),
            fromItemId: entry.fromId, toItemId: entry.toId,
            pointsCm: entry.points.map((p): SiteLinePoint => [p[0], p[1]]),
            sort: entry.sort, notes: cleanNotes(entry.notes), updatedBy: actor,
          }).returning();
          linesById.set(row.id, row);
        } else if (op.type === 'updateLine') {
          const existing = linesById.get(op.id);
          if (!existing) throw new Error(`unknown site line ${op.id}`);
          const stored = storedLinePatch(op.patch);
          if (stored.fromId !== undefined || stored.toId !== undefined) {
            const ends = lineEndsRefusal(existing.kind, endOf(stored.fromId ?? existing.fromItemId), endOf(stored.toId ?? existing.toItemId));
            if (ends !== null) throw new Error(ends);
          }
          const set = lineSet(stored, actor);
          await tx.update(siteLines).set(set).where(eq(siteLines.id, op.id));
          linesById.set(op.id, { ...existing, ...set });
        } else {
          if (!linesById.has(op.id)) throw new Error(`unknown site line ${op.id}`);
          await tx.delete(siteLines).where(eq(siteLines.id, op.id));
          linesById.delete(op.id);
        }
        continue;
      }
      if ((op.type === 'update' || op.type === 'remove') && !byId.has(op.id)) {
        skipped.push(op.id);
        continue;
      }
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
        if (!existing) throw new Error(`unknown site item ${op.id}`); // unreachable: skipped above
        const locked = lockRefusal(existing.locked, op.patch);
        if (locked !== null) throw new Error(locked);
        if (op.patch.taskId !== undefined && op.patch.taskId !== null) {
          await assertBuildTask(tx, op.patch.taskId, plan.seasonId);
        }
        if (op.patch.kind !== undefined) {
          const rekind = rekindRefusal(op.patch.kind, linesAt(op.id));
          if (rekind !== null) throw new Error(rekind);
        }
        const set = patchSet(existing, op.patch, actor);
        await tx.update(siteItems).set(set).where(eq(siteItems.id, op.id));
        byId.set(op.id, { ...existing, ...set } as ItemRow);
      } else if (op.type === 'remove') {
        const existing = byId.get(op.id);
        if (!existing) throw new Error(`unknown site item ${op.id}`); // unreachable: skipped above
        if (existing.locked) throw new Error('that item is locked');
        await tx.delete(siteItems).where(eq(siteItems.id, op.id));
        byId.delete(op.id);
        // The database cascades the item's lines away (`site.ts`); the map of rows follows it.
        for (const line of linesAt(op.id)) linesById.delete(line.id);
      } else if (op.type === 'setKindDefault') {
        if (op.size === null) {
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
      } else {
        // `setUnderlay`: written from Task 4 of the Part C plan on, when its table exists. No client sends one before.
        throw new Error('unknown operation');
      }
    }

    if (skipped.length === ops.length) return { status: 'saved', version: plan.version, skipped };
    const version = plan.version + 1;
    await tx.update(sitePlans).set({ version, updatedAt: new Date(), updatedBy: actor })
      .where(eq(sitePlans.id, planId));
    return { status: 'saved', version, skipped };
  });
}
