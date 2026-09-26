import { asc, desc, eq, sql } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { isBlank } from '@/lib/text/normalize';
import { sitePlanSnapshots } from '@/db/schema/site';
import type { EditorItem, EditorLine, EditorPlot } from './editor/model';
import { groupIdOf } from './editor/model';
import { lineEndsRefusal, newItemRefusal, newLineRefusal } from './editor/ops';
import { planById } from './plan';

/**
 * Saved plans (תוכניות שמורות): a map kept under a name, to come back to.
 *
 * A lead arranging the camp tries things — the kitchen here, the tents
 * there — and wants to keep one arrangement while trying another, and to
 * put several side by side and decide later. Undo only walks back one
 * session, in order; this keeps a whole map, by name, for as long as the
 * plan exists.
 *
 * What is kept is what the editor showed when the lead pressed save: its
 * items and lines as `EditorItem` and `EditorLine`, the same shape the
 * editor saves through, plus the plot's figures for the card to compare
 * against. It comes from the editor's own doc rather than from the rows, so
 * an edit made a second before — not yet saved in the background — is in
 * the plan the lead sees saved. Loading a plan back is not done here: the
 * editor works out the ops that take the map on screen to the kept one
 * (`editor/restore.ts`) and saves them like any other edit, so a load is one
 * undo step and goes through the version check like everything else.
 *
 * Every refusal is English with a stable prefix; `failure-messages.ts` turns
 * it into Hebrew at the action boundary (R9).
 */

/** Names are for telling plans apart at a glance; a sentence is not a name. */
export const MAX_SNAPSHOT_NAME = 60;
/** More than this and the list stops being a list one can choose from. */
export const MAX_SNAPSHOTS_PER_PLAN = 30;

export interface SnapshotPlot {
  widthCm: number;
  depthCm: number;
  gridCm: number;
  northDeg: number;
}

/** What one saved plan holds: the map's arrangement, and the plot it was drawn on. */
export interface SnapshotContent {
  plot: SnapshotPlot;
  items: EditorItem[];
  lines: EditorLine[];
}

/** One row of the card's list: enough to choose by, never the arrangement itself. */
export interface SnapshotSummary {
  id: string;
  name: string;
  plot: SnapshotPlot;
  itemCount: number;
  lineCount: number;
  /** ISO, so it crosses the action boundary unchanged; the card formats it. */
  createdAt: string;
  createdBy: string | null;
}

export interface Snapshot extends SnapshotSummary {
  items: EditorItem[];
  lines: EditorLine[];
}

function isWhole(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** The plot's four figures as the editor holds them — the same shape `EditorPlot` carries, less its id. */
export function snapshotPlotOf(plot: EditorPlot): SnapshotPlot {
  return { widthCm: plot.widthCm, depthCm: plot.depthCm, gridCm: plot.gridCm, northDeg: plot.northDeg };
}

export function samePlot(a: SnapshotPlot, b: SnapshotPlot): boolean {
  return a.widthCm === b.widthCm && a.depthCm === b.depthCm && a.gridCm === b.gridCm && a.northDeg === b.northDeg;
}

/**
 * The name as it is stored: trimmed, and neither blank nor too long. The
 * refusal names the rule, so the card can say it before a request is made.
 */
export function snapshotNameRefusal(name: unknown): string | null {
  if (typeof name !== 'string' || isBlank(name)) return 'a saved plan must have a name';
  if (name.trim().length > MAX_SNAPSHOT_NAME) return `a saved plan name must be at most ${MAX_SNAPSHOT_NAME} characters`;
  return null;
}

/**
 * The content as the server will store it, or the reason it will not. An
 * item is checked as a new item is (`newItemRefusal`); a line as a new line
 * is, and its two ends must be items of this very plan that its kind may
 * join — what `applySiteOps` checks against the rows, checked here against
 * the kept items, so a plan that is kept can always be loaded back. Anything
 * arriving here came over a request and may be any shape at all.
 */
export function snapshotContentRefusal(content: unknown): string | null {
  if (typeof content !== 'object' || content === null) return 'a saved plan must hold a plot, its items and its lines';
  const { plot, items, lines } = content as { plot?: unknown; items?: unknown; lines?: unknown };
  if (typeof plot !== 'object' || plot === null) return 'a saved plan must hold a plot, its items and its lines';
  const { widthCm, depthCm, gridCm, northDeg } = plot as Record<string, unknown>;
  if (!isWhole(widthCm) || !isWhole(depthCm) || !isWhole(gridCm) || !isWhole(northDeg)) {
    return 'a saved plan must hold a plot, its items and its lines';
  }
  if (!Array.isArray(items) || !Array.isArray(lines)) return 'a saved plan must hold a plot, its items and its lines';

  const ids = new Set<string>();
  for (const entry of items as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return 'an item id must be a uuid';
    const refusal = newItemRefusal(entry as EditorItem);
    if (refusal !== null) return refusal;
    const { id } = entry as EditorItem;
    if (ids.has(id)) return 'a saved plan names an item twice';
    ids.add(id);
  }
  const byId = new Map((items as EditorItem[]).map((entry) => [entry.id, entry]));
  const lineIds = new Set<string>();
  for (const entry of lines as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return 'a line id must be a uuid';
    const refusal = newLineRefusal(entry as EditorLine);
    if (refusal !== null) return refusal;
    const line = entry as EditorLine;
    if (lineIds.has(line.id)) return 'a saved plan names a line twice';
    lineIds.add(line.id);
    const ends = lineEndsRefusal(line.kind, byId.get(line.fromId), byId.get(line.toId));
    if (ends !== null) return ends;
  }
  return null;
}

/** A fresh copy holding only the fields the editor's shapes name, so nothing a request smuggled in is stored. */
function storedContent(content: SnapshotContent): SnapshotContent {
  return {
    plot: {
      widthCm: content.plot.widthCm, depthCm: content.plot.depthCm,
      gridCm: content.plot.gridCm, northDeg: content.plot.northDeg,
    },
    items: content.items.map((entry) => ({
      id: entry.id, kind: entry.kind, label: entry.label.trim(),
      xCm: entry.xCm, yCm: entry.yCm, widthCm: entry.widthCm, depthCm: entry.depthCm,
      heightCm: entry.heightCm ?? null,
      insetCm: entry.kind === 'shade' ? (entry.insetCm ?? null) : null,
      ropeAngleDeg: entry.kind === 'shade' ? (entry.ropeAngleDeg ?? null) : null,
      // A page older than facings sends none: the drawn orientation, as `applySiteOps` reads it.
      facing: entry.facing ?? 0,
      sort: entry.sort, taskId: entry.taskId ?? null,
      notes: entry.notes === null || entry.notes === undefined || isBlank(entry.notes) ? null : entry.notes.trim(),
      locked: entry.locked === true,
      groupId: groupIdOf(entry),
    })),
    lines: content.lines.map((entry) => ({
      id: entry.id, kind: entry.kind, label: entry.label.trim(), fromId: entry.fromId, toId: entry.toId,
      points: entry.points.map((p) => [p[0], p[1]] as [number, number]),
      sort: entry.sort,
      notes: entry.notes === null || entry.notes === undefined || isBlank(entry.notes) ? null : entry.notes.trim(),
    })),
  };
}

/** The content read back as the editor's shapes; a row this module wrote always fits them. */
function contentOf(row: typeof sitePlanSnapshots.$inferSelect): SnapshotContent {
  const stored = row.content as SnapshotContent;
  return { plot: stored.plot, items: stored.items, lines: stored.lines };
}

/** Keeps the map as `content` shows it, under `name`; answers the new row's id. */
export async function takeSnapshot(
  db: AnyDb, planId: string, name: string, content: SnapshotContent, actor: string,
): Promise<string> {
  const nameRefusal = snapshotNameRefusal(name);
  if (nameRefusal !== null) throw new Error(nameRefusal);
  const contentRefusal = snapshotContentRefusal(content);
  if (contentRefusal !== null) throw new Error(contentRefusal);
  if (!(await planById(db, planId))) throw new Error(`unknown site plan ${planId}`);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(sitePlanSnapshots).where(eq(sitePlanSnapshots.planId, planId));
  if (count >= MAX_SNAPSHOTS_PER_PLAN) {
    throw new Error(`a map keeps at most ${MAX_SNAPSHOTS_PER_PLAN} saved plans`);
  }
  const [row] = await db.insert(sitePlanSnapshots)
    .values({ planId, name: name.trim(), content: storedContent(content), createdBy: actor })
    .returning();
  return row.id;
}

/** The map's saved plans, newest first — what the card lists. Never their arrangements. */
export async function listSnapshots(db: AnyDb, planId: string): Promise<SnapshotSummary[]> {
  const rows = await db.select({
    id: sitePlanSnapshots.id,
    name: sitePlanSnapshots.name,
    plot: sql<SnapshotPlot>`${sitePlanSnapshots.content} -> 'plot'`,
    itemCount: sql<number>`jsonb_array_length(${sitePlanSnapshots.content} -> 'items')::int`,
    lineCount: sql<number>`jsonb_array_length(${sitePlanSnapshots.content} -> 'lines')::int`,
    createdAt: sitePlanSnapshots.createdAt,
    createdBy: sitePlanSnapshots.createdBy,
  })
    .from(sitePlanSnapshots)
    .where(eq(sitePlanSnapshots.planId, planId))
    .orderBy(desc(sitePlanSnapshots.createdAt), asc(sitePlanSnapshots.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    plot: row.plot,
    itemCount: row.itemCount,
    lineCount: row.lineCount,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  }));
}

/** One saved plan, whole — what the editor loads back. Null when there is no such plan. */
export async function readSnapshot(db: AnyDb, id: string): Promise<(Snapshot & { planId: string }) | null> {
  const [row] = await db.select().from(sitePlanSnapshots).where(eq(sitePlanSnapshots.id, id)).limit(1);
  if (row === undefined) return null;
  const content = contentOf(row);
  return {
    id: row.id,
    planId: row.planId,
    name: row.name,
    plot: content.plot,
    itemCount: content.items.length,
    lineCount: content.lines.length,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    items: content.items,
    lines: content.lines,
  };
}

/** Forgets a saved plan. The map itself is untouched: a saved plan is a copy, never the map. */
export async function deleteSnapshot(db: AnyDb, id: string): Promise<void> {
  const rows = await db.delete(sitePlanSnapshots).where(eq(sitePlanSnapshots.id, id)).returning();
  if (rows.length === 0) throw new Error(`unknown saved plan ${id}`);
}
