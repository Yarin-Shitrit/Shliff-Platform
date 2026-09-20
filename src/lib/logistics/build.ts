import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { isBlank } from '@/lib/text/normalize';
import { tasks } from '@/db/schema/camp';
import type { TaskStatus } from '@/db/schema/camp';
import {
  taskMaterials, acquisitionItems, inventoryItems,
  type AcquisitionStatus, type ItemCondition,
} from '@/db/schema/logistics';
import { coverageFor, type TaskCoverage } from '@/lib/work/coverage';

/**
 * What a build task needs in order to happen.
 *
 * The tasks themselves are not this module's: they are `tasks` rows of kind
 * `build`, read through `coverageFor` — the same function the משימות board
 * uses — so the two screens can never disagree about who is on a task or when
 * it is due. What is added here is the list of things each one needs.
 *
 * **No stored status.** `task_materials` has no status column, and this file
 * is the reason. Whether a material is `במחסן`, `הושג` or `צריך להשיג` is a
 * fact about two other tables right now: a stored copy would still read
 * `במחסן` after somebody took the thing, and a checklist that lies about what
 * the camp has is worse than no checklist, because people stop bringing spares.
 */

export type MaterialState =
  /** On a shelf, in working order. */
  | 'in_stock'
  /** On a shelf and not usable as it stands — still a blocker, and a findable one. */
  | 'needs_repair'
  /** Bought or ordered, not yet on any shelf. */
  | 'obtained'
  /** Nobody has it and nobody has ordered it. */
  | 'missing';

export interface MaterialInventoryRef {
  id: string;
  locationText: string | null;
  condition: ItemCondition;
  quantity: number;
}

export interface MaterialAcquisitionRef {
  id: string;
  status: AcquisitionStatus;
}

export interface MaterialRow {
  id: string;
  taskId: string;
  name: string;
  quantityNeeded: number;
  state: MaterialState;
  /** Where the answer lives, so every row links to the screen that can change it. */
  inventory: MaterialInventoryRef | null;
  acquisition: MaterialAcquisitionRef | null;
}

export interface BuildTask {
  taskId: string;
  title: string;
  status: TaskStatus;
  dueOn: Date | null;
  peopleNeeded: number;
  accepted: number;
  uncovered: boolean;
  assignees: TaskCoverage['assignees'];
  materials: MaterialRow[];
  /**
   * The task's own line in the `מצב החומר` column, derived from its materials
   * and never stored. `none` is a task nobody has listed materials for, which
   * is different from one whose materials are all present.
   */
  materialState: 'ready' | 'needs_repair' | 'missing' | 'none';
}

/**
 * The derivation, as a pure function over what was resolved.
 *
 * `item` is the inventory row this material actually resolves to — either the
 * one it points at directly, or the one its acquisition arrived into. That
 * second path matters: once an order is registered in the warehouse, the
 * material is on a shelf, and a rule that looked only at the direct link
 * would keep reading `הושג` for something a lead could go and pick up.
 *
 * A `retired` item reads as missing on purpose. The row is still shown with
 * its location — the camp does own a broken one — but a checklist that says
 * `במחסן` for a pump that is out of service is the failure this whole screen
 * exists to prevent.
 */
export function materialState(
  item: MaterialInventoryRef | null,
  acquisition: MaterialAcquisitionRef | null,
): MaterialState {
  if (item !== null) {
    if (item.condition === 'ready') return 'in_stock';
    if (item.condition === 'retired') return 'missing';
    return 'needs_repair';
  }
  if (acquisition !== null) {
    if (acquisition.status === 'ordered' || acquisition.status === 'arrived') return 'obtained';
    return 'missing';
  }
  return 'missing';
}

/** The worst state among a task's materials — what the task row reports. */
export function taskMaterialState(materials: readonly MaterialRow[]): BuildTask['materialState'] {
  if (materials.length === 0) return 'none';
  if (materials.some((material) => material.state === 'missing')) return 'missing';
  if (materials.some((material) => material.state === 'needs_repair')) return 'needs_repair';
  return 'ready';
}

/**
 * Every material for a set of tasks, with both sides resolved.
 *
 * Three queries rather than a join per row: the number of build tasks in a
 * season is small and the number of distinct materials smaller, and a join
 * that reaches `acquisition_items` and then `inventory_items` through
 * `arrived_item_id` is a great deal harder to read than the chain it encodes.
 */
export async function listMaterials(db: AnyDb, taskIds: string[]): Promise<MaterialRow[]> {
  if (taskIds.length === 0) return [];

  const rows = await db.select().from(taskMaterials)
    .where(inArray(taskMaterials.taskId, taskIds))
    .orderBy(asc(taskMaterials.createdAt));
  if (rows.length === 0) return [];

  const acquisitionIds = rows
    .map((row) => row.acquisitionItemId)
    .filter((id): id is string => id !== null);
  const acquisitions = acquisitionIds.length === 0 ? [] : await db.select()
    .from(acquisitionItems).where(inArray(acquisitionItems.id, acquisitionIds));

  /* Both ways a material can reach a shelf: its own link, and the shelf its
     order arrived into. */
  const itemIds = [
    ...rows.map((row) => row.inventoryItemId),
    ...acquisitions.map((acquisition) => acquisition.arrivedItemId),
  ].filter((id): id is string => id !== null);
  const items = itemIds.length === 0 ? [] : await db.select()
    .from(inventoryItems).where(inArray(inventoryItems.id, itemIds));

  const itemById = new Map(items.map((item) => [item.id, item]));
  const acquisitionById = new Map(acquisitions.map((one) => [one.id, one]));

  return rows.map((row) => {
    const acquisitionRow = row.acquisitionItemId === null
      ? undefined : acquisitionById.get(row.acquisitionItemId);

    const resolvedItemId = row.inventoryItemId ?? acquisitionRow?.arrivedItemId ?? null;
    const itemRow = resolvedItemId === null ? undefined : itemById.get(resolvedItemId);

    const inventory: MaterialInventoryRef | null = itemRow === undefined ? null : {
      id: itemRow.id,
      locationText: itemRow.locationText,
      condition: itemRow.condition,
      quantity: itemRow.quantity,
    };
    const acquisition: MaterialAcquisitionRef | null = acquisitionRow === undefined ? null : {
      id: acquisitionRow.id,
      status: acquisitionRow.status,
    };

    return {
      id: row.id,
      taskId: row.taskId,
      name: row.name,
      quantityNeeded: row.quantityNeeded,
      state: materialState(inventory, acquisition),
      inventory,
      acquisition,
    };
  });
}

/**
 * The build tasks of one season, each with its materials.
 *
 * Ordered so that what is blocked comes first — a task waiting on something
 * is the reason to open this screen — and by deadline inside each group, with
 * undated tasks last because a date is how these are actually thought about.
 */
export async function listBuildTasks(db: AnyDb, seasonId: string): Promise<BuildTask[]> {
  const coverage = (await coverageFor(db, seasonId)).filter((row) => row.kind === 'build');
  const materials = await listMaterials(db, coverage.map((row) => row.taskId));

  const byTask = new Map<string, MaterialRow[]>();
  for (const material of materials) {
    const list = byTask.get(material.taskId) ?? [];
    list.push(material);
    byTask.set(material.taskId, list);
  }

  const rows: BuildTask[] = coverage.map((row) => {
    const own = byTask.get(row.taskId) ?? [];
    return {
      taskId: row.taskId,
      title: row.title,
      status: row.status,
      dueOn: row.dueOn,
      peopleNeeded: row.peopleNeeded,
      accepted: row.accepted,
      uncovered: row.uncovered,
      assignees: row.assignees,
      materials: own,
      materialState: taskMaterialState(own),
    };
  });

  const RANK: Record<BuildTask['materialState'], number> = {
    missing: 0, needs_repair: 1, none: 2, ready: 3,
  };

  return rows.sort((a, b) => {
    if (RANK[a.materialState] !== RANK[b.materialState]) {
      return RANK[a.materialState] - RANK[b.materialState];
    }
    if (a.dueOn === null && b.dueOn === null) return a.title.localeCompare(b.title, 'he');
    if (a.dueOn === null) return 1;
    if (b.dueOn === null) return -1;
    return a.dueOn.getTime() - b.dueOn.getTime();
  });
}

export interface BuildCounts {
  openTasks: number;
  /** Tasks held up by at least one material that is missing or unusable. */
  blockedTasks: number;
  missingMaterials: number;
  repairMaterials: number;
  /** Of the missing ones, how many are already on the רכש list. */
  missingOnAcquisitionList: number;
  nextDueOn: Date | null;
}

export function buildCounts(rows: readonly BuildTask[]): BuildCounts {
  const open = rows.filter((row) => row.status === 'open');
  const materials = rows.flatMap((row) => row.materials);
  const missing = materials.filter((material) => material.state === 'missing');

  const due = open
    .map((row) => row.dueOn)
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  return {
    openTasks: open.length,
    blockedTasks: open.filter(
      (row) => row.materialState === 'missing' || row.materialState === 'needs_repair',
    ).length,
    missingMaterials: missing.length,
    repairMaterials: materials.filter((material) => material.state === 'needs_repair').length,
    missingOnAcquisitionList: missing.filter((material) => material.acquisition !== null).length,
    nextDueOn: due[0] ?? null,
  };
}

/**
 * What the `הוספת חומר` drawer sends. Exactly one of the two links may be
 * set, or neither: a material that points at both a shelf and an order is two
 * answers to one question, and this module would then have to pick, which is
 * the guessing the product refuses to do.
 */
export interface MaterialInput {
  taskId: string;
  name: string;
  quantityNeeded: number;
  inventoryItemId: string | null;
  acquisitionItemId: string | null;
}

export async function addMaterial(db: AnyDb, input: MaterialInput): Promise<string> {
  if (isBlank(input.name)) throw new Error('a material must have a name');
  if (!Number.isInteger(input.quantityNeeded) || input.quantityNeeded < 1) {
    throw new Error('a material quantity must be a whole number, one or more');
  }
  if (input.inventoryItemId !== null && input.acquisitionItemId !== null) {
    throw new Error('a material may point at stock or at an order, not at both');
  }

  const [task] = await db.select().from(tasks)
    .where(and(eq(tasks.id, input.taskId), eq(tasks.kind, 'build'))).limit(1);
  if (!task) throw new Error(`unknown build task ${input.taskId}`);

  if (input.inventoryItemId !== null) {
    const [item] = await db.select().from(inventoryItems)
      .where(eq(inventoryItems.id, input.inventoryItemId)).limit(1);
    if (!item) throw new Error(`unknown inventory item ${input.inventoryItemId}`);
  }
  if (input.acquisitionItemId !== null) {
    const [order] = await db.select().from(acquisitionItems)
      .where(eq(acquisitionItems.id, input.acquisitionItemId)).limit(1);
    if (!order) throw new Error(`unknown acquisition ${input.acquisitionItemId}`);
  }

  const [row] = await db.insert(taskMaterials)
    .values({
      taskId: input.taskId,
      name: input.name.trim(),
      quantityNeeded: input.quantityNeeded,
      inventoryItemId: input.inventoryItemId,
      acquisitionItemId: input.acquisitionItemId,
    })
    .returning();
  return row.id;
}

/**
 * Removing a requirement is a real delete, unlike most of this platform.
 *
 * The rule the product keeps is that a *fact* is never deleted — a broken
 * pump becomes a row that says so. A material line is not a fact about the
 * world; it is somebody's statement that this task needs that thing, and
 * withdrawing it leaves nothing unexplained. Neither the stock nor the order
 * it pointed at is touched.
 */
export async function removeMaterial(db: AnyDb, id: string): Promise<void> {
  const [row] = await db.select().from(taskMaterials)
    .where(eq(taskMaterials.id, id)).limit(1);
  if (!row) throw new Error(`unknown material ${id}`);

  await db.delete(taskMaterials).where(eq(taskMaterials.id, id));
}
