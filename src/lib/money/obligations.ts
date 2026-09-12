import { and, asc, eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { obligations, obligationSettlements } from '@/db/schema/money';
import type { ObligationDirection, SettlementKind } from '@/db/schema/money';
import { persons } from '@/db/schema/camp';
import { toAgorot, fromAgorot } from '@/lib/money';
import { isBlank } from '@/lib/text/normalize';

export interface NewObligation {
  direction: ObligationDirection;
  partyPersonId?: string;
  partyName?: string;
  description: string;
  amount: number;
  seasonId?: string;
  openedOn: Date;
  sourceBlockId?: string;
  sourceRow?: number;
}

export interface NewSettlement {
  obligationId: string;
  amount: number;
  kind: SettlementKind;
  ledgerEntryId?: string;
  paymentId?: string;
  /** Required on an offset: what it was set against. */
  note?: string;
  settledOn: Date;
  recordedBy: string;
}

export interface SettlementRow {
  id: string;
  amountAgorot: number;
  kind: SettlementKind;
  ledgerEntryId: string | null;
  paymentId: string | null;
  note: string | null;
  settledOn: Date;
}

export interface ObligationRow {
  id: string;
  direction: ObligationDirection;
  partyPersonId: string | null;
  partyName: string | null;
  /** The linked person's name, else the raw string, else null. */
  displayParty: string | null;
  description: string;
  amountAgorot: number;
  settledAgorot: number;
  outstandingAgorot: number;
  settled: boolean;
  /** No linked person and no recorded name. Can never be settled. */
  unnamed: boolean;
  seasonId: string | null;
  sourceBlockId: string | null;
  sourceRow: number | null;
  settlements: SettlementRow[];
}

export async function createObligation(db: AnyDb, input: NewObligation): Promise<string> {
  if (isBlank(input.description)) throw new Error('לחוב חייב להיות תיאור');
  if (input.amount <= 0) throw new Error('סכום חוב חייב להיות חיובי');
  // `isBlank`, not `.trim()`: a party name that survives only as an invisible
  // directional mark must land as null, or an unnamed obligation reads as
  // named and slips out of `unnamedObligations` — the exact hiding this
  // module exists to prevent.
  const [row] = await db.insert(obligations).values({
    direction: input.direction,
    partyPersonId: input.partyPersonId ?? null,
    partyName: isBlank(input.partyName) ? null : input.partyName!,
    description: input.description,
    amount: fromAgorot(toAgorot(input.amount)),
    seasonId: input.seasonId ?? null,
    openedOn: input.openedOn,
    sourceBlockId: input.sourceBlockId ?? null,
    sourceRow: input.sourceRow ?? null,
  }).returning();
  return row.id;
}

export async function listObligations(
  db: AnyDb, filter: { direction?: ObligationDirection; seasonId?: string } = {},
): Promise<ObligationRow[]> {
  const where = [];
  if (filter.direction) where.push(eq(obligations.direction, filter.direction));
  if (filter.seasonId) where.push(eq(obligations.seasonId, filter.seasonId));

  const rows = await db
    .select({
      obligation: obligations,
      personName: persons.displayName,
    })
    .from(obligations)
    .leftJoin(persons, eq(persons.id, obligations.partyPersonId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(obligations.openedOn));

  const all = await db.select().from(obligationSettlements)
    .orderBy(asc(obligationSettlements.settledOn));

  const byObligation = new Map<string, SettlementRow[]>();
  for (const row of all) {
    const list = byObligation.get(row.obligationId) ?? [];
    list.push({
      id: row.id,
      amountAgorot: toAgorot(row.amount),
      kind: row.kind,
      ledgerEntryId: row.ledgerEntryId,
      paymentId: row.paymentId,
      note: row.note,
      settledOn: row.settledOn,
    });
    byObligation.set(row.obligationId, list);
  }

  return rows.map(({ obligation, personName }) => {
    const settlements = byObligation.get(obligation.id) ?? [];
    const amountAgorot = toAgorot(obligation.amount);
    const settledAgorot = settlements.reduce((n, s) => n + s.amountAgorot, 0);
    return {
      id: obligation.id,
      direction: obligation.direction,
      partyPersonId: obligation.partyPersonId,
      partyName: obligation.partyName,
      displayParty: personName ?? obligation.partyName ?? null,
      description: obligation.description,
      amountAgorot,
      settledAgorot,
      outstandingAgorot: Math.max(0, amountAgorot - settledAgorot),
      settled: settledAgorot >= amountAgorot,
      // A name with no confident person link (`יוסף`) is still a name — only
      // the total absence of both counts as unnamed. Treating a merely
      // unlinked party as unnamed would put a known creditor into the "nobody
      // knows who to pay" queue that exists for the other two rows.
      unnamed: !obligation.partyPersonId && !obligation.partyName,
      seasonId: obligation.seasonId,
      sourceBlockId: obligation.sourceBlockId,
      sourceRow: obligation.sourceRow,
      settlements,
    };
  });
}

/**
 * Discharges part or all of an obligation.
 *
 * An obligation with no party can never be settled. `שולם 500 — מקפיא
 * באיחסון נוסף` records money a member fronted and no name at all; marking it
 * settled would close the only record that anyone is owed anything, which is
 * exactly how the link was lost the first time.
 */
export async function settleObligation(db: AnyDb, input: NewSettlement): Promise<string> {
  if (input.amount <= 0) throw new Error('סכום קיזוז חייב להיות חיובי');
  // Same rule `recordOffset` already enforces in src/lib/fees/payments.ts:
  // an offset with no note is a debt discharged against nothing anyone can
  // check later.
  if (input.kind === 'offset' && isBlank(input.note)) {
    throw new Error('קיזוז חייב לשאת הערה שאומרת מול מה קוזז');
  }

  const [obligation] = await db.select().from(obligations)
    .where(eq(obligations.id, input.obligationId));
  if (!obligation) throw new Error(`חוב לא קיים: ${input.obligationId}`);

  if (!obligation.partyPersonId && !obligation.partyName) {
    throw new Error('אי אפשר לסגור חוב בלי שם — לא ידוע למי מגיע הכסף');
  }

  const existing = await db.select().from(obligationSettlements)
    .where(eq(obligationSettlements.obligationId, input.obligationId));
  const already = existing.reduce((n, row) => n + toAgorot(row.amount), 0);
  if (already + toAgorot(input.amount) > toAgorot(obligation.amount)) {
    throw new Error('אי אפשר לקזז יותר ממה שחייבים');
  }

  const [row] = await db.insert(obligationSettlements).values({
    obligationId: input.obligationId,
    amount: fromAgorot(toAgorot(input.amount)),
    kind: input.kind,
    ledgerEntryId: input.ledgerEntryId ?? null,
    paymentId: input.paymentId ?? null,
    note: isBlank(input.note) ? null : input.note!,
    settledOn: input.settledOn,
    recordedBy: input.recordedBy,
  }).returning();
  return row.id;
}

export async function unnamedObligations(db: AnyDb): Promise<ObligationRow[]> {
  return (await listObligations(db)).filter((row) => row.unnamed);
}
