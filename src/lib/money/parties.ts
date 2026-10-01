import {
  and, asc, desc, eq, inArray,
} from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { campEvents, seasons } from '@/db/schema/camp';
import {
  accounts, ledgerEntries, obligationSettlements,
} from '@/db/schema/money';
import type { LedgerDirection, PartyPart } from '@/db/schema/money';
import { HebrewRefusal } from '@/lib/errors/hebrew';
import { toAgorot } from '@/lib/money';
import { isBlank } from '@/lib/text/normalize';
import { recordEntry } from './ledger';

/**
 * Parties are how the camp makes its money, so each one is read as a small
 * profit-and-loss: what tickets and the bar brought in, what the party cost,
 * and — when it was made with another camp — what passed between the two.
 *
 * Every figure here is a sum of `ledger_entries` rows carrying the party's
 * `event_id`. Nothing is stored beside them: a party's result is derived the
 * same way an account's balance is, so the two can never disagree.
 *
 * What the ledger holds is the camp's own cash. For a shared party that means
 * the camp's side only, and what the camp kept is `netAgorot` — the partner's
 * share is a movement like any other (`partner`), not a percentage applied
 * after the fact. That is why there is no "whole party profit" for a shared
 * party: the other camp's takings never touched this ledger, and a figure
 * built from half the money would be a guess wearing a number.
 */

export const PARTY_PART_LABELS: Readonly<Record<PartyPart, string>> = {
  tickets: 'כרטיסים',
  bar: 'בר',
  cost: 'הוצאה',
  partner: 'התחשבנות עם השותף',
};

/** The direction a part's money always moves in. `partner` goes either way. */
const FIXED_DIRECTION: Readonly<Partial<Record<PartyPart, LedgerDirection>>> = {
  tickets: 'in',
  bar: 'in',
  cost: 'out',
};

export interface PartyTotals {
  ticketsAgorot: number;
  barAgorot: number;
  costAgorot: number;
  /** What the partner camp paid the camp. */
  partnerInAgorot: number;
  /** What the camp paid the partner camp. */
  partnerOutAgorot: number;
  /** Rows carrying this party's event but no part — imported or written
   *  before parts existed. Counted in the net, and shown apart so a lead can
   *  see they are unsorted rather than have them folded into tickets. */
  unsortedInAgorot: number;
  unsortedOutAgorot: number;
  /** Everything in, minus everything out: what the party left in the camp's
   *  hands. */
  netAgorot: number;
  count: number;
}

export interface PartySummary extends PartyTotals {
  id: string;
  name: string;
  seasonId: string;
  seasonName: string;
  heldOn: Date | null;
  partnerName: string | null;
}

export interface PartyMovement {
  id: string;
  occurredOn: Date;
  direction: LedgerDirection;
  amountAgorot: number;
  description: string;
  part: PartyPart | null;
  accountId: string | null;
  accountName: string | null;
  /** Typed by a lead rather than read off a workbook — the only kind this
   *  page may delete, since a promoted row would come back on the next import. */
  manual: boolean;
}

export interface PartyDetail extends PartySummary {
  movements: PartyMovement[];
}

export interface NewParty {
  seasonId: string;
  name: string;
  heldOn: Date;
  partnerName?: string;
}

export interface PartyEdit {
  name: string;
  heldOn: Date;
  /** Undefined or blank means the camp made the party alone. */
  partnerName?: string;
}

export interface NewPartyMovement {
  eventId: string;
  part: PartyPart;
  /** Only read for `partner`, the one part whose money moves either way. */
  direction?: LedgerDirection;
  /** In shekels. Positive — `direction` carries the sign. */
  amount: number;
  occurredOn: Date;
  /** Required for a cost. A ticket, bar or partner row is named after the
   *  party when left blank. */
  description?: string;
  accountId?: string;
  recordedBy: string;
}

function emptyTotals(): PartyTotals {
  return {
    ticketsAgorot: 0,
    barAgorot: 0,
    costAgorot: 0,
    partnerInAgorot: 0,
    partnerOutAgorot: 0,
    unsortedInAgorot: 0,
    unsortedOutAgorot: 0,
    netAgorot: 0,
    count: 0,
  };
}

function addTo(
  totals: PartyTotals,
  row: { direction: LedgerDirection; amountAgorot: number; part: PartyPart | null },
): void {
  const { direction, amountAgorot, part } = row;
  totals.count += 1;
  totals.netAgorot += direction === 'in' ? amountAgorot : -amountAgorot;
  // A row whose part and direction disagree cannot be written through
  // `recordPartyMovement`, but the column is plain text and an import could
  // still produce one. It is counted as unsorted rather than flipped to fit.
  if (part === 'partner') {
    if (direction === 'in') totals.partnerInAgorot += amountAgorot;
    else totals.partnerOutAgorot += amountAgorot;
  } else if (part !== null && FIXED_DIRECTION[part] === direction) {
    if (part === 'tickets') totals.ticketsAgorot += amountAgorot;
    else if (part === 'bar') totals.barAgorot += amountAgorot;
    else totals.costAgorot += amountAgorot;
  } else if (direction === 'in') {
    totals.unsortedInAgorot += amountAgorot;
  } else {
    totals.unsortedOutAgorot += amountAgorot;
  }
}

function cleanPartner(value: string | undefined | null): string | null {
  return value === undefined || value === null || isBlank(value) ? null : value.trim();
}

function validParty(name: string, heldOn: Date): void {
  if (isBlank(name)) throw new HebrewRefusal('למסיבה חייב להיות שם');
  if (Number.isNaN(heldOn.getTime())) throw new HebrewRefusal('למסיבה חייב להיות תאריך');
}

async function partyRow(db: AnyDb, eventId: string) {
  const [row] = await db
    .select({
      id: campEvents.id,
      name: campEvents.name,
      kind: campEvents.kind,
      seasonId: campEvents.seasonId,
      seasonName: seasons.name,
      heldOn: campEvents.heldOn,
      partnerName: campEvents.partnerName,
    })
    .from(campEvents)
    .innerJoin(seasons, eq(seasons.id, campEvents.seasonId))
    .where(eq(campEvents.id, eventId));
  // The burn is a `camp_events` row too, but it is not a party: its money is
  // the season's, and a P&L for it would double-count the whole budget.
  return row !== undefined && row.kind === 'fundraiser' ? row : undefined;
}

/** A party is a `fundraiser` event. Returns its id. */
export async function createParty(db: AnyDb, input: NewParty): Promise<string> {
  validParty(input.name, input.heldOn);
  const [row] = await db.insert(campEvents).values({
    seasonId: input.seasonId,
    name: input.name.trim(),
    kind: 'fundraiser',
    heldOn: input.heldOn,
    partnerName: cleanPartner(input.partnerName),
  }).returning();
  return row.id;
}

export async function updateParty(db: AnyDb, eventId: string, input: PartyEdit): Promise<void> {
  validParty(input.name, input.heldOn);
  const party = await partyRow(db, eventId);
  if (party === undefined) throw new HebrewRefusal('אין מסיבה כזו');
  const partnerName = cleanPartner(input.partnerName);
  if (partnerName === null && party.partnerName !== null) {
    // Removing the partner would leave its movements naming a camp the party
    // no longer has. They have to go first, so the lead sees what is lost.
    const [settled] = await db.select({ id: ledgerEntries.id }).from(ledgerEntries)
      .where(and(eq(ledgerEntries.eventId, eventId), eq(ledgerEntries.partyPart, 'partner')))
      .limit(1);
    if (settled !== undefined) {
      throw new HebrewRefusal('יש התחשבנות רשומה עם הקאמפ השותף. מחקו אותה לפני שמסירים את השותף.');
    }
  }
  await db.update(campEvents).set({
    name: input.name.trim(),
    heldOn: input.heldOn,
    partnerName,
  }).where(eq(campEvents.id, eventId));
}

/**
 * Records one movement of a party's money. The season is the party's own —
 * a party belongs to the year it was held for, and asking again would only
 * let the two disagree.
 */
export async function recordPartyMovement(
  db: AnyDb, input: NewPartyMovement,
): Promise<string> {
  const party = await partyRow(db, input.eventId);
  if (party === undefined) throw new HebrewRefusal('אין מסיבה כזו');
  if (Number.isNaN(input.occurredOn.getTime())) {
    throw new HebrewRefusal('לתנועה חייב להיות תאריך');
  }

  let direction: LedgerDirection;
  if (input.part === 'partner') {
    if (party.partnerName === null) {
      throw new HebrewRefusal('למסיבה הזו לא רשום קאמפ שותף');
    }
    if (input.direction === undefined) {
      throw new HebrewRefusal('צריך לבחור אם שילמנו לשותף או שהשותף שילם לנו');
    }
    direction = input.direction;
  } else {
    direction = FIXED_DIRECTION[input.part]!;
    if (input.direction !== undefined && input.direction !== direction) {
      throw new HebrewRefusal(direction === 'in'
        ? `${PARTY_PART_LABELS[input.part]} הם תמיד כסף שנכנס`
        : 'הוצאה היא תמיד כסף שיצא');
    }
  }

  let description = input.description?.trim() ?? '';
  if (isBlank(description)) {
    if (input.part === 'cost') throw new HebrewRefusal('להוצאה חייב להיות תיאור — על מה שילמנו');
    description = input.part === 'partner'
      ? `התחשבנות עם ${party.partnerName} — ${party.name}`
      : `${PARTY_PART_LABELS[input.part]} — ${party.name}`;
  }

  return recordEntry(db, {
    occurredOn: input.occurredOn,
    direction,
    amount: input.amount,
    description,
    accountId: input.accountId,
    seasonId: party.seasonId,
    eventId: party.id,
    partyPart: input.part,
    recordedBy: input.recordedBy,
  });
}

/**
 * Removes a movement a lead typed on a party's page — the way back from a
 * wrong amount. Anything with a history beyond that page is refused rather
 * than silently broken.
 */
export async function deletePartyMovement(
  db: AnyDb, eventId: string, entryId: string,
): Promise<void> {
  const [entry] = await db
    .select({
      id: ledgerEntries.id,
      sourceBlockId: ledgerEntries.sourceBlockId,
      transferGroupId: ledgerEntries.transferGroupId,
    })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.id, entryId), eq(ledgerEntries.eventId, eventId)));
  if (entry === undefined) throw new HebrewRefusal('התנועה הזו לא שייכת למסיבה הזו');
  if (entry.sourceBlockId !== null) {
    throw new HebrewRefusal('התנועה הזו נקראה מגיליון, ותחזור בייבוא הבא. מתקנים אותה בקובץ.');
  }
  if (entry.transferGroupId !== null) {
    throw new HebrewRefusal('התנועה הזו היא חצי מהעברה בין חשבונות, ואי אפשר למחוק רק אותה');
  }
  const [settles] = await db.select({ id: obligationSettlements.id })
    .from(obligationSettlements)
    .where(eq(obligationSettlements.ledgerEntryId, entryId))
    .limit(1);
  if (settles !== undefined) {
    throw new HebrewRefusal('התנועה הזו סוגרת חוב. בטלו את הסגירה בדף החובות לפני שמוחקים אותה.');
  }
  await db.delete(ledgerEntries).where(eq(ledgerEntries.id, entryId));
}

/** Every party ever held, newest first, each with its totals. */
export async function listParties(db: AnyDb): Promise<PartySummary[]> {
  const parties = await db
    .select({
      id: campEvents.id,
      name: campEvents.name,
      seasonId: campEvents.seasonId,
      seasonName: seasons.name,
      seasonYear: seasons.year,
      heldOn: campEvents.heldOn,
      partnerName: campEvents.partnerName,
    })
    .from(campEvents)
    .innerJoin(seasons, eq(seasons.id, campEvents.seasonId))
    .where(eq(campEvents.kind, 'fundraiser'))
    .orderBy(desc(seasons.year), desc(campEvents.heldOn), asc(campEvents.name));

  const ids = parties.map((party) => party.id);
  const rows = ids.length === 0 ? [] : await db
    .select({
      eventId: ledgerEntries.eventId,
      direction: ledgerEntries.direction,
      amount: ledgerEntries.amount,
      part: ledgerEntries.partyPart,
    })
    .from(ledgerEntries)
    .where(inArray(ledgerEntries.eventId, ids));

  const totals = new Map(ids.map((id) => [id, emptyTotals()]));
  for (const row of rows) {
    addTo(totals.get(row.eventId!)!, {
      direction: row.direction, amountAgorot: toAgorot(row.amount), part: row.part,
    });
  }

  // Postgres sorts a null `held_on` first under DESC; a party with no date is
  // the least known, so it goes last within its year instead.
  // The sort is stable, so the query's own date order survives within a year.
  const dated = (one: { heldOn: Date | null }) => (one.heldOn === null ? 1 : 0);
  return [...parties]
    .sort((a, b) => (b.seasonYear - a.seasonYear) || (dated(a) - dated(b)))
    .map((party) => ({
      id: party.id,
      name: party.name,
      seasonId: party.seasonId,
      seasonName: party.seasonName,
      heldOn: party.heldOn,
      partnerName: party.partnerName,
      ...totals.get(party.id)!,
    }));
}

/** One party and every movement of its money, oldest first. Undefined when
 *  there is no such party. */
export async function partyDetail(db: AnyDb, eventId: string): Promise<PartyDetail | undefined> {
  const party = await partyRow(db, eventId);
  if (party === undefined) return undefined;

  const rows = await db
    .select({
      id: ledgerEntries.id,
      occurredOn: ledgerEntries.occurredOn,
      direction: ledgerEntries.direction,
      amount: ledgerEntries.amount,
      description: ledgerEntries.description,
      part: ledgerEntries.partyPart,
      accountId: ledgerEntries.accountId,
      accountName: accounts.name,
      sourceBlockId: ledgerEntries.sourceBlockId,
      transferGroupId: ledgerEntries.transferGroupId,
    })
    .from(ledgerEntries)
    .leftJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
    .where(eq(ledgerEntries.eventId, eventId))
    .orderBy(asc(ledgerEntries.occurredOn), asc(ledgerEntries.createdAt));

  const totals = emptyTotals();
  const movements: PartyMovement[] = rows.map((row) => {
    const movement = {
      id: row.id,
      occurredOn: row.occurredOn,
      direction: row.direction,
      amountAgorot: toAgorot(row.amount),
      description: row.description,
      part: row.part,
      accountId: row.accountId,
      accountName: row.accountName ?? null,
      manual: row.sourceBlockId === null && row.transferGroupId === null,
    };
    addTo(totals, movement);
    return movement;
  });

  return {
    id: party.id,
    name: party.name,
    seasonId: party.seasonId,
    seasonName: party.seasonName,
    heldOn: party.heldOn,
    partnerName: party.partnerName,
    ...totals,
    movements,
  };
}
