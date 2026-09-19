import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { inventoryItems, type ItemCondition, type LogisticsCategory } from '@/db/schema/logistics';
import type { WarehouseQuery } from './warehouse-views';

export interface WarehouseRow {
  id: string;
  name: string;
  category: LogisticsCategory;
  quantity: number;
  locationText: string | null;
  condition: ItemCondition;
  notes: string | null;
  updatedBy: string | null;
  updatedAt: Date;
}

/**
 * Worst first. Somebody opening the warehouse is asking what has to be dealt
 * with before the camp leaves, so the rows that need a decision sort to the
 * top and `retired` sorts last — it is a settled fact, not a to-do.
 */
const CONDITION_RANK: Record<ItemCondition, number> = {
  needs_repair: 0,
  needs_testing: 1,
  ready: 2,
  retired: 3,
};

const ATTENTION: readonly ItemCondition[] = ['needs_testing', 'needs_repair'];

const CATEGORIES: readonly LogisticsCategory[] = [
  'kitchen', 'sanitation', 'living', 'build', 'general',
];

/**
 * Every filter in one place, so the list, the counts and the totals row can
 * never disagree about what "the current view" means. They are computed from
 * the same predicate rather than from three hand-written ones.
 */
function predicate(query: WarehouseQuery) {
  const clauses = [];

  if (query.view === 'attention') clauses.push(inArray(inventoryItems.condition, [...ATTENTION]));
  if (query.view === 'retired') clauses.push(eq(inventoryItems.condition, 'retired'));
  if (query.category) clauses.push(eq(inventoryItems.category, query.category));

  if (query.q) {
    const needle = `%${query.q}%`;
    // Name *and* location: "what is in the blue box" is a question people ask
    // while standing in the storage unit, and the search box promises both.
    clauses.push(or(ilike(inventoryItems.name, needle), ilike(inventoryItems.locationText, needle)));
  }

  return clauses.length ? and(...clauses) : undefined;
}

function ordering(query: WarehouseQuery) {
  const dir = query.dir === 'desc' ? desc : asc;
  switch (query.sort) {
    case 'name': return [dir(inventoryItems.name)];
    case 'category': return [dir(inventoryItems.category), asc(inventoryItems.name)];
    case 'quantity': return [dir(inventoryItems.quantity), asc(inventoryItems.name)];
    case 'location': return [dir(inventoryItems.locationText), asc(inventoryItems.name)];
    case 'condition':
    default:
      // Ordered by meaning, not alphabetically. `asc(condition)` would give
      // needs_repair, needs_testing, ready, retired only by accident of
      // spelling, and would silently reorder if a state were ever renamed.
      return [
        dir(sql`case ${inventoryItems.condition}
          when 'needs_repair' then ${CONDITION_RANK.needs_repair}
          when 'needs_testing' then ${CONDITION_RANK.needs_testing}
          when 'ready' then ${CONDITION_RANK.ready}
          else ${CONDITION_RANK.retired} end`),
        asc(inventoryItems.name),
      ];
  }
}

/** The camp's gear. No season: inventory outlives a burn (R5). */
export async function listWarehouse(db: AnyDb, query: WarehouseQuery): Promise<WarehouseRow[]> {
  const rows = await db.select().from(inventoryItems)
    .where(predicate(query))
    .orderBy(...ordering(query));
  return rows as WarehouseRow[];
}

export interface WarehouseCounts {
  /** Per category, over the WHOLE warehouse — a chip count must not move
   *  when a filter is applied, or the control claims there is nothing to
   *  switch to. */
  byCategory: Record<LogisticsCategory, number>;
  /** Over the current filter, so the footer agrees with the rows above it. */
  shownRows: number;
  shownQuantity: number;
  needsTesting: number;
  needsRepair: number;
  total: number;
}

export async function warehouseCounts(db: AnyDb, query: WarehouseQuery): Promise<WarehouseCounts> {
  const all = await db.select().from(inventoryItems);
  const shown = await listWarehouse(db, query);

  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => [c, all.filter((r) => r.category === c).length]),
  ) as Record<LogisticsCategory, number>;

  return {
    byCategory,
    shownRows: shown.length,
    shownQuantity: shown.reduce((sum, r) => sum + r.quantity, 0),
    needsTesting: all.filter((r) => r.condition === 'needs_testing').length,
    needsRepair: all.filter((r) => r.condition === 'needs_repair').length,
    total: all.length,
  };
}

/** Null rather than a throw: the id comes from a URL someone may have edited. */
export async function itemById(db: AnyDb, id: string): Promise<WarehouseRow | null> {
  const [row] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id)).limit(1);
  return (row as WarehouseRow | undefined) ?? null;
}

/**
 * The one write this screen makes. `updatedBy` is recorded because a condition
 * is a judgement — "needs repair" is somebody's opinion about a pump, and in
 * eight months the useful question is whose.
 */
export async function setCondition(
  db: AnyDb, id: string, condition: ItemCondition, actor: string,
): Promise<void> {
  await db.update(inventoryItems)
    .set({ condition, updatedBy: actor, updatedAt: new Date() })
    .where(eq(inventoryItems.id, id));
}
