import { asc, eq, sql } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { fundingTargets, ticketRounds } from '@/db/schema/money';
import { seasons } from '@/db/schema/camp';
import { budgetTotalAgorot } from './budget';
import { toAgorot, fromAgorot } from '@/lib/money';
import { isBlank } from '@/lib/text/normalize';

export interface NewFundingTarget {
  seasonId: string;
  label: string;
  amount: number;
  note?: string;
  sourceBlockId?: string;
  sourceRow?: number;
}

export interface NewTicketRound {
  seasonId: string;
  eventId?: string;
  label: string;
  quantity?: number;
  price?: number;
  total: number;
  sold?: boolean;
  sourceBlockId?: string;
  sourceRow?: number;
}

export interface DuesFundingIdentity {
  seasonId: string;
  budgetTotalAgorot: number;
  plannedSize: number | null;
  flatRateAgorot: number;
  /** flatRate × plannedSize — what dues are expected to cover. */
  duesCoverAgorot: number | null;
  fundingTargetAgorot: number;
  /** The whole budget divided by the camp, null when the size is unknown. */
  perPersonFullAgorot: number | null;
  /** The fundraising target divided by the camp. */
  perPersonFundingAgorot: number | null;
  /**
   * Whether `flatRate + perPersonFunding === perPersonFull`. Computed from two
   * independent divisions rather than by subtraction, so that a budget and a
   * fundraising target which do not actually add up are reported as not
   * adding up instead of being made to look as though they do. Subtracting
   * (`perPersonFull - flatRate`) would make this field trivially true for
   * every season, because it defines `perPersonFunding` in terms of the very
   * quantity it is supposed to check against — the one sentence this module
   * exists to state ("dues plus fundraising equals the true per-head cost")
   * would then hold by construction instead of by fact.
   */
  closes: boolean;
}

export async function createFundingTarget(
  db: AnyDb, input: NewFundingTarget,
): Promise<string> {
  if (isBlank(input.label)) throw new Error('ליעד גיוס חייב להיות שם');
  const [row] = await db.insert(fundingTargets).values({
    seasonId: input.seasonId,
    label: input.label,
    amount: fromAgorot(toAgorot(input.amount)),
    note: input.note ?? null,
    sourceBlockId: input.sourceBlockId ?? null,
    sourceRow: input.sourceRow ?? null,
  }).returning();
  return row.id;
}

export async function listFundingTargets(db: AnyDb, seasonId: string) {
  return db.select().from(fundingTargets)
    .where(eq(fundingTargets.seasonId, seasonId))
    .orderBy(asc(fundingTargets.label));
}

export async function fundingTotalAgorot(db: AnyDb, seasonId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${fundingTargets.amount}), 0)` })
    .from(fundingTargets)
    .where(eq(fundingTargets.seasonId, seasonId));
  return toAgorot(row.total);
}

export async function createTicketRound(db: AnyDb, input: NewTicketRound): Promise<string> {
  if (isBlank(input.label)) throw new Error('לסבב כרטיסים חייב להיות שם');
  const [row] = await db.insert(ticketRounds).values({
    seasonId: input.seasonId,
    eventId: input.eventId ?? null,
    label: input.label,
    quantity: input.quantity ?? null,
    price: input.price === undefined ? null : fromAgorot(toAgorot(input.price)),
    total: fromAgorot(toAgorot(input.total)),
    sold: input.sold ?? false,
    sourceBlockId: input.sourceBlockId ?? null,
    sourceRow: input.sourceRow ?? null,
  }).returning();
  return row.id;
}

export async function listTicketRounds(db: AnyDb, seasonId: string) {
  return db.select().from(ticketRounds)
    .where(eq(ticketRounds.seasonId, seasonId))
    .orderBy(asc(ticketRounds.label));
}

export async function ticketTotalAgorot(db: AnyDb, seasonId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${ticketRounds.total}), 0)` })
    .from(ticketRounds)
    .where(eq(ticketRounds.seasonId, seasonId));
  return toAgorot(row.total);
}

/**
 * The sentence no cell of any workbook states: the whole budget divided by
 * the camp is the true per-head cost; the flat rate is what members pay;
 * fundraising is supposed to cover the rest. This computes both halves
 * independently from the database and checks whether they actually agree,
 * rather than assuming they do.
 */
export async function duesFundingIdentity(
  db: AnyDb, seasonId: string,
): Promise<DuesFundingIdentity> {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!season) throw new Error(`עונה לא נמצאה: ${seasonId}`);

  const budget = await budgetTotalAgorot(db, seasonId);
  const funding = await fundingTotalAgorot(db, seasonId);
  const flatRateAgorot = toAgorot(season.flatRate);
  const size = season.plannedSize;

  // No planned size means no honest per-head figure exists — inventing one
  // (e.g. returning 0) would silently claim a camp size nobody planned.
  if (!size) {
    return {
      seasonId, budgetTotalAgorot: budget, plannedSize: null, flatRateAgorot,
      duesCoverAgorot: null, fundingTargetAgorot: funding,
      perPersonFullAgorot: null, perPersonFundingAgorot: null, closes: false,
    };
  }

  // Two independent divisions on integer agorot, each rounded on its own —
  // never `Math.floor` (183926 instead of 183929, which would break the
  // identity below) and never one derived by subtracting the other (see the
  // `closes` field's own comment for why that would be worse than a rounding
  // bug: it would make the check pass unconditionally).
  const perPersonFull = Math.round(budget / size);
  const perPersonFunding = Math.round(funding / size);

  return {
    seasonId,
    budgetTotalAgorot: budget,
    plannedSize: size,
    flatRateAgorot,
    duesCoverAgorot: flatRateAgorot * size,
    fundingTargetAgorot: funding,
    perPersonFullAgorot: perPersonFull,
    perPersonFundingAgorot: perPersonFunding,
    closes: flatRateAgorot + perPersonFunding === perPersonFull,
  };
}
