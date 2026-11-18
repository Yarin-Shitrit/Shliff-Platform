import {
  and, asc, eq, ne,
} from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { AnyDb } from '@/lib/db-types';
import {
  accounts, budgetLines, ledgerEntries, obligationSettlements,
} from '@/db/schema/money';
import type { LedgerDirection, PartyPart } from '@/db/schema/money';
import { payments, dues, persons } from '@/db/schema/camp';
import { toAgorot, fromAgorot } from '@/lib/money';
import { isBlank } from '@/lib/text/normalize';
import { HebrewRefusal } from '@/lib/errors/hebrew';

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

/** What a lead may change on a movement they typed. Every field is the whole
 *  new value: an omitted account, season or budget line means "none", never
 *  "leave it" — the form shows all of them, so what it sends is what it means. */
export interface EntryEdit {
  occurredOn: Date;
  direction: LedgerDirection;
  /** In shekels. Must be positive — `direction` carries the sign. */
  amount: number;
  description: string;
  accountId?: string;
  seasonId?: string;
  budgetLineId?: string;
}

/** Verbatim on the screen, so the row's missing control and the library's
 *  refusal cannot come to say different things. */
export const ENTRY_REFUSALS = {
  missing: 'התנועה הזו כבר לא קיימת. רעננו את הדף.',
  fromSheet: 'התנועה הזו נקראה מגיליון, ותחזור בייבוא הבא. מתקנים אותה בקובץ.',
  transferEdit: 'התנועה הזו היא חצי מהעברה בין חשבונות, ואי אפשר לשנות רק אותה',
  transferDelete: 'התנועה הזו היא חצי מהעברה בין חשבונות, ואי אפשר למחוק רק אותה',
  party: 'התנועה הזו שייכת למסיבה. מתקנים אותה בדף המסיבה.',
  settlesEdit: 'התנועה הזו סוגרת חוב, ולכן אי אפשר לשנות את הסכום או את הכיוון שלה',
  settlesDelete: 'התנועה הזו סוגרת חוב. בטלו את הסגירה בדף החובות לפני שמוחקים אותה.',
  noDate: 'לתנועה חייב להיות תאריך',
  noAccount: 'החשבון שנבחר לא קיים',
  noBudgetLine: 'סעיף התקציב שנבחר לא קיים',
  budgetSeason: 'סעיף התקציב שנבחר שייך לשנה אחרת. בחרו סעיף מהשנה של התנועה.',
} as const;

/**
 * Whether a movement is one a lead may change or remove from the ledger
 * screen: typed by hand, not half of a transfer, not a party's line. The one
 * rule both the row's controls and the two functions below read.
 *
 * A sheet's row would come back on the next import (`promote` upserts on its
 * source key, so an edit is overwritten and a delete is undone). One leg of a
 * transfer changed alone leaves two accounts disagreeing about one movement.
 * A party's line has a part that fixes its direction and wording, and its own
 * page is where that is kept true.
 */
export function entryIsOpen(entry: {
  sourceBlockId: string | null; transferGroupId: string | null; eventId: string | null;
}): boolean {
  return entry.sourceBlockId === null && entry.transferGroupId === null
    && entry.eventId === null;
}

async function openEntry(db: AnyDb, id: string, change: 'edit' | 'delete') {
  const [entry] = await db
    .select({
      id: ledgerEntries.id,
      direction: ledgerEntries.direction,
      amount: ledgerEntries.amount,
      sourceBlockId: ledgerEntries.sourceBlockId,
      transferGroupId: ledgerEntries.transferGroupId,
      eventId: ledgerEntries.eventId,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.id, id));
  if (entry === undefined) throw new HebrewRefusal(ENTRY_REFUSALS.missing);
  if (entry.sourceBlockId !== null) throw new HebrewRefusal(ENTRY_REFUSALS.fromSheet);
  if (entry.transferGroupId !== null) {
    throw new HebrewRefusal(change === 'edit'
      ? ENTRY_REFUSALS.transferEdit : ENTRY_REFUSALS.transferDelete);
  }
  if (entry.eventId !== null) throw new HebrewRefusal(ENTRY_REFUSALS.party);
  const [settles] = await db.select({ id: obligationSettlements.id })
    .from(obligationSettlements)
    .where(eq(obligationSettlements.ledgerEntryId, id))
    .limit(1);
  return { entry, settlesDebt: settles !== undefined };
}

/**
 * Corrects a movement a lead typed — the wrong amount, the wrong קופה, a
 * description that names nobody.
 *
 * A movement that closes a debt keeps its amount and direction: the
 * settlement beside it carries the same figure, and changing one alone would
 * have the debts page and the ledger disagree about what was paid. Its date,
 * description, account, season and budget line are its own and may change.
 *
 * Who recorded the movement is not rewritten. There is no column for who
 * corrected it, and stamping the corrector over the recorder would lose the
 * one name the row does carry.
 */
export async function updateEntry(db: AnyDb, id: string, input: EntryEdit): Promise<void> {
  if (Number.isNaN(input.occurredOn.getTime())) throw new HebrewRefusal(ENTRY_REFUSALS.noDate);
  validate({ ...input, recordedBy: '' });
  const { entry, settlesDebt } = await openEntry(db, id, 'edit');

  const amount = fromAgorot(toAgorot(input.amount));
  if (settlesDebt
    && (input.direction !== entry.direction || toAgorot(amount) !== toAgorot(entry.amount))) {
    throw new HebrewRefusal(ENTRY_REFUSALS.settlesEdit);
  }

  if (input.accountId !== undefined) {
    const [account] = await db.select({ id: accounts.id }).from(accounts)
      .where(eq(accounts.id, input.accountId));
    if (account === undefined) throw new HebrewRefusal(ENTRY_REFUSALS.noAccount);
  }
  if (input.budgetLineId !== undefined) {
    const [line] = await db.select({ seasonId: budgetLines.seasonId }).from(budgetLines)
      .where(eq(budgetLines.id, input.budgetLineId));
    if (line === undefined) throw new HebrewRefusal(ENTRY_REFUSALS.noBudgetLine);
    // A budget line is one season's plan. Spend filed under another year's
    // line would be counted against a budget the movement is not part of.
    if (line.seasonId !== input.seasonId) throw new HebrewRefusal(ENTRY_REFUSALS.budgetSeason);
  }

  await db.update(ledgerEntries).set({
    occurredOn: input.occurredOn,
    direction: input.direction,
    amount,
    description: input.description,
    accountId: input.accountId ?? null,
    seasonId: input.seasonId ?? null,
    budgetLineId: input.budgetLineId ?? null,
  }).where(eq(ledgerEntries.id, id));
}

/**
 * Removes a movement a lead typed. It leaves the ledger and its account's
 * balance; nothing else pointed at it, because everything that could — a
 * sheet, a transfer's other leg, a party, a closed debt — is refused above.
 */
export async function deleteEntry(db: AnyDb, id: string): Promise<void> {
  const { settlesDebt } = await openEntry(db, id, 'delete');
  if (settlesDebt) throw new HebrewRefusal(ENTRY_REFUSALS.settlesDelete);
  await db.delete(ledgerEntries).where(eq(ledgerEntries.id, id));
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
