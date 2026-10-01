import {
  and, asc, eq, ne,
} from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { AnyDb } from '@/lib/db-types';
import { accounts, ledgerEntries } from '@/db/schema/money';
import type { LedgerDirection, PartyPart } from '@/db/schema/money';
import { payments, dues, persons } from '@/db/schema/camp';
import { toAgorot, fromAgorot } from '@/lib/money';
import { isBlank } from '@/lib/text/normalize';

export interface NewEntry {
  occurredOn: Date;
  direction: LedgerDirection;
  /** In shekels. Must be positive — `direction` carries the sign. */
  amount: number;
  description: string;
  accountId?: string;
  seasonId?: string;
  eventId?: string;
  /** Only with `eventId`. `recordPartyMovement` is the caller that sets it. */
  partyPart?: PartyPart;
  budgetLineId?: string;
  transferGroupId?: string;
  recordedBy: string;
  sourceBlockId?: string;
  sourceRow?: number;
}

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  /** In shekels. Must be positive. */
  amount: number;
  occurredOn: Date;
  description: string;
  recordedBy: string;
  seasonId?: string;
}

export interface Movement {
  id: string;
  /** Which table it came from. The ledger is a union, never a copy. */
  source: 'ledger' | 'dues';
  occurredOn: Date;
  direction: LedgerDirection;
  amountAgorot: number;
  description: string;
  accountId: string | null;
  accountName: string | null;
  seasonId: string | null;
  eventId: string | null;
  /** Non-null on both legs of a transfer, and only on those — the field
   *  `recordTransfer` writes to make a transfer identifiable as one
   *  movement (requirement 6). Always null on a plain `recordEntry` row and
   *  on a dues payment, since neither is one half of a transfer. */
  transferGroupId: string | null;
  /** R11: every number keeps its provenance. Null on a dues payment, which
   *  has no source columns and genuinely was typed by a lead. */
  sourceBlockId: string | null;
  sourceRow: number | null;
}

export interface MovementFilter {
  seasonId?: string;
  accountId?: string;
  eventId?: string;
}

function validate(input: NewEntry): void {
  // direction carries the sign, so an amount is never signed — this is the
  // whole reason a zero or negative amount is a hard refusal rather than a
  // value the caller could still misread as "an out of zero".
  if (input.amount <= 0) {
    throw new Error('סכום תנועה חייב להיות חיובי — הכיוון נושא את הסימן');
  }
  if (isBlank(input.description)) throw new Error('לתנועה חייב להיות תיאור');
}

export async function recordEntry(db: AnyDb, input: NewEntry): Promise<string> {
  validate(input);
  const [row] = await db.insert(ledgerEntries).values({
    occurredOn: input.occurredOn,
    direction: input.direction,
    amount: fromAgorot(toAgorot(input.amount)),
    description: input.description,
    accountId: input.accountId ?? null,
    seasonId: input.seasonId ?? null,
    eventId: input.eventId ?? null,
    partyPart: input.partyPart ?? null,
    budgetLineId: input.budgetLineId ?? null,
    transferGroupId: input.transferGroupId ?? null,
    recordedBy: input.recordedBy,
    sourceBlockId: input.sourceBlockId ?? null,
    sourceRow: input.sourceRow ?? null,
  }).returning();
  return row.id;
}

/**
 * Two entries sharing a `transferGroupId`. Written as a pair rather than as
 * one signed row so that every account's balance stays a plain sum. The two
 * `recordEntry` calls below are sequential awaits, not one transaction — a
 * crash between them is possible — but the shared `transferGroupId` still
 * makes the pair identifiable as one movement after the fact, which is what
 * a transfer needs: the group id, not atomicity, is the guarantee this
 * function makes.
 */
export async function recordTransfer(
  db: AnyDb, input: TransferInput,
): Promise<[string, string]> {
  if (input.fromAccountId === input.toAccountId) {
    throw new Error('אי אפשר להעביר לאותו חשבון');
  }
  const group = randomUUID();
  const out = await recordEntry(db, {
    occurredOn: input.occurredOn, direction: 'out', amount: input.amount,
    description: input.description, accountId: input.fromAccountId,
    seasonId: input.seasonId, transferGroupId: group, recordedBy: input.recordedBy,
  });
  const into = await recordEntry(db, {
    occurredOn: input.occurredOn, direction: 'in', amount: input.amount,
    description: input.description, accountId: input.toAccountId,
    seasonId: input.seasonId, transferGroupId: group, recordedBy: input.recordedBy,
  });
  return [out, into];
}

/**
 * The ledger, read. A union of `ledger_entries` and `payments` — never a copy
 * of one into the other, so no row can disagree with its twin because no row
 * has one. `deletePayment` already exists and would silently orphan a copy;
 * a union cannot drift because there is only ever one row for any movement.
 *
 * A `קיזוז` payment is excluded, matching `unattributedAgorot` in
 * `accounts.ts`: it settles a due against a debt the camp already owes the
 * payer, so no cash moves. Counting it here would report every offset-settled
 * due as fresh income — a season that settles `יוסף קארינה יונתן ירין ועילאי`
 * through the 6,000 offset would show 6,000 more "in" than it ever received.
 */
export async function listMovements(
  db: AnyDb, filter: MovementFilter = {},
): Promise<Movement[]> {
  const entryWhere = [];
  if (filter.seasonId) entryWhere.push(eq(ledgerEntries.seasonId, filter.seasonId));
  if (filter.accountId) entryWhere.push(eq(ledgerEntries.accountId, filter.accountId));
  if (filter.eventId) entryWhere.push(eq(ledgerEntries.eventId, filter.eventId));

  const entries = await db
    .select({
      id: ledgerEntries.id,
      occurredOn: ledgerEntries.occurredOn,
      direction: ledgerEntries.direction,
      amount: ledgerEntries.amount,
      description: ledgerEntries.description,
      accountId: ledgerEntries.accountId,
      accountName: accounts.name,
      seasonId: ledgerEntries.seasonId,
      eventId: ledgerEntries.eventId,
      transferGroupId: ledgerEntries.transferGroupId,
      sourceBlockId: ledgerEntries.sourceBlockId,
      sourceRow: ledgerEntries.sourceRow,
    })
    .from(ledgerEntries)
    .leftJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
    .where(entryWhere.length ? and(...entryWhere) : undefined)
    .orderBy(asc(ledgerEntries.occurredOn));

  // Always excluded, not just when a filter asks for it: a קיזוז moves no
  // cash, so it is never part of "the ledger" regardless of what else is
  // being filtered on.
  const dueWhere = [ne(payments.channel, 'קיזוז')];
  if (filter.seasonId) dueWhere.push(eq(dues.seasonId, filter.seasonId));
  if (filter.accountId) dueWhere.push(eq(payments.accountId, filter.accountId));

  // A dues payment has no eventId of its own — filtering by event must
  // exclude it rather than silently ignore the filter, or a per-event report
  // would show every payment ever made regardless of the event asked for.
  const paid = filter.eventId ? [] : await db
    .select({
      id: payments.id,
      occurredOn: payments.paidOn,
      amount: payments.amount,
      accountId: payments.accountId,
      accountName: accounts.name,
      seasonId: dues.seasonId,
      displayName: persons.displayName,
    })
    .from(payments)
    .innerJoin(dues, eq(dues.id, payments.dueId))
    .innerJoin(persons, eq(persons.id, dues.personId))
    .leftJoin(accounts, eq(accounts.id, payments.accountId))
    .where(and(...dueWhere))
    .orderBy(asc(payments.paidOn));

  const all: Movement[] = [
    ...entries.map((row) => ({
      id: row.id, source: 'ledger' as const, occurredOn: row.occurredOn,
      direction: row.direction, amountAgorot: toAgorot(row.amount),
      description: row.description, accountId: row.accountId,
      accountName: row.accountName ?? null, seasonId: row.seasonId, eventId: row.eventId,
      transferGroupId: row.transferGroupId,
      sourceBlockId: row.sourceBlockId,
      sourceRow: row.sourceRow,
    })),
    ...paid.map((row) => ({
      id: row.id, source: 'dues' as const, occurredOn: row.occurredOn,
      direction: 'in' as const, amountAgorot: toAgorot(row.amount),
      description: `דמי קאמפ — ${row.displayName}`, accountId: row.accountId,
      accountName: row.accountName ?? null, seasonId: row.seasonId, eventId: null,
      // A dues payment is never one leg of a transfer.
      transferGroupId: null,
      // `payments` carries no provenance columns — a dues payment genuinely
      // was typed by a lead, not read off a workbook.
      sourceBlockId: null,
      sourceRow: null,
    })),
  ];

  return all.sort((a, b) => a.occurredOn.getTime() - b.occurredOn.getTime());
}

export async function ledgerTotals(
  db: AnyDb, filter: MovementFilter = {},
): Promise<{ inAgorot: number; outAgorot: number; netAgorot: number; count: number }> {
  const moves = await listMovements(db, filter);
  let inAgorot = 0;
  let outAgorot = 0;
  for (const move of moves) {
    if (move.direction === 'in') inAgorot += move.amountAgorot;
    else outAgorot += move.amountAgorot;
  }
  return { inAgorot, outAgorot, netAgorot: inAgorot - outAgorot, count: moves.length };
}
