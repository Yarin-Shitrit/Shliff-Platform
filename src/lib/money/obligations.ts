import {
  and, asc, eq, sql,
} from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { obligations, obligationSettlements } from '@/db/schema/money';
import type { ObligationDirection, SettlementKind } from '@/db/schema/money';
import { persons } from '@/db/schema/camp';
import { toAgorot, fromAgorot } from '@/lib/money';
import { HebrewRefusal } from '@/lib/errors/hebrew';
import { isBlank } from '@/lib/text/normalize';

export interface NewObligation {
  direction: ObligationDirection;
  partyPersonId?: string;
  partyName?: string;
  description: string;
  amount: number;
  seasonId?: string;
  /** `null` means the workbook does not say when this debt opened — a
   * required key, so callers must say "no date" explicitly rather than
   * have one stamped in for them. */
  openedOn: Date | null;
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
  /** `null` means the workbook does not say when this debt opened. */
  openedOn: Date | null;
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
    // Explicit nulls-last rather than relying on Postgres's ASC default: a
    // dateless obligation (the workbook did not say) belongs after every
    // dated one, and that has to be stated, not assumed.
    .orderBy(sql`${obligations.openedOn} asc nulls last`);

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
      //
      // `isBlank`, not plain truthiness: `createObligation` normalises
      // `partyName` to null on write, but this is the read side, and it is
      // read for every row regardless of which writer produced it. A
      // `partyName` of only invisible directional marks is truthy — a plain
      // `!obligation.partyName` check would call that row named.
      unnamed: !obligation.partyPersonId && isBlank(obligation.partyName),
      openedOn: obligation.openedOn,
      seasonId: obligation.seasonId,
      sourceBlockId: obligation.sourceBlockId,
      sourceRow: obligation.sourceRow,
      settlements,
    };
  });
}

/**
 * Every refusal `settleObligation` makes, without writing anything.
 *
 * Extracted so a caller that has to perform *two* writes — a cash settlement
 * records a ledger entry and then the settlement itself — can make every
 * refusal a lead could trigger fire before the first write rather than
 * between the two. The window does not close (these are sequential awaits,
 * not a transaction) but it narrows to failures nobody can provoke on
 * purpose.
 *
 * An obligation with no party can never be settled. `שולם 500 — מקפיא
 * באיחסון נוסף` records money a member fronted and no name at all; marking it
 * settled would close the only record that anyone is owed anything, which is
 * exactly how the link was lost the first time.
 */
export async function checkSettlement(db: AnyDb, input: NewSettlement): Promise<void> {
  if (input.amount <= 0) throw new Error('סכום קיזוז חייב להיות חיובי');
  // Same rule `recordOffset` already enforces in src/lib/fees/payments.ts:
  // an offset with no note is a debt discharged against nothing anyone can
  // check later.
  if (input.kind === 'offset' && isBlank(input.note)) {
    throw new Error('קיזוז חייב לשאת הערה שאומרת מול מה קוזז');
  }

  const [obligation] = await db.select().from(obligations)
    .where(eq(obligations.id, input.obligationId));
  // `HebrewRefusal`, not `Error`: this message interpolates a uuid, and a
  // uuid is hex, so it carries Latin letters and `toHebrewError`'s alphabet
  // passthrough could never return it — the lead got the generic fallback and
  // the reason was lost silently (§5 A20).
  if (!obligation) throw new HebrewRefusal(`חוב לא קיים: ${input.obligationId}`);

  // Same `isBlank` reasoning as `unnamed` above in `listObligations`: this
  // guard runs against whatever is in the row, not just rows `createObligation`
  // produced, and a truthy-but-invisible `partyName` must still refuse.
  if (!obligation.partyPersonId && isBlank(obligation.partyName)) {
    throw new Error('אי אפשר לסגור חוב בלי שם — לא ידוע למי מגיע הכסף');
  }

  const existing = await db.select().from(obligationSettlements)
    .where(eq(obligationSettlements.obligationId, input.obligationId));
  const already = existing.reduce((n, row) => n + toAgorot(row.amount), 0);
  if (already + toAgorot(input.amount) > toAgorot(obligation.amount)) {
    throw new Error('אי אפשר לקזז יותר ממה שחייבים');
  }
}

/**
 * Discharges part or all of an obligation.
 *
 * Every refusal lives in `checkSettlement` above, which this calls first, so
 * there is exactly one list of them and a caller can consult it in advance
 * without writing anything.
 */
export async function settleObligation(db: AnyDb, input: NewSettlement): Promise<string> {
  await checkSettlement(db, input);

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

export interface ObligationParty {
  obligationId: string;
  /** Someone the roster knows. */
  partyPersonId?: string;
  /** Someone it does not — a supplier, or a person nobody has recorded yet. */
  partyName?: string;
}

/** Verbatim on the screen that offers the form, so both say the same thing. */
export const PARTY_REFUSALS = {
  neither: 'רישום למי החוב חייב לציין אדם מהרשימה או שם',
  both: 'רשמו או אדם מהרשימה או שם — לא את שניהם',
  alreadyLinked: 'לחוב הזה כבר רשום אדם. כדי לשנות, פנו למנהל הקאמפ',
  noSuchPerson: 'האדם שנבחר לא נמצא ברשימת האנשים',
} as const;

/**
 * Records who a debt belongs to.
 *
 * This is the only way a nameless obligation ever leaves the "nobody knows
 * who to pay" queue: it cannot be settled and cannot be dismissed, so a lead
 * who finally learns that `שולם 500 — מקפיא באיחסון נוסף` was fronted by רוני
 * needs somewhere to write that down. Linking a person is preferred, because
 * it puts the debt on their page; a bare name is allowed for a supplier or
 * for someone the roster has not met yet, and it is stored exactly as the
 * promoter stores an unattributed name, so `unnamed` clears the same way.
 *
 * A debt that already points at a person is refused rather than re-pointed.
 * Re-linking is a correction to a fact somebody else recorded, and the ledger
 * entries written for its settlements already carry the old name in their
 * description; that is a decision for a lead, not a form field. A debt that
 * carries only a raw name may be linked, since the raw spelling is kept
 * alongside the link the way the promoter keeps it.
 */
export async function nameObligation(db: AnyDb, input: ObligationParty): Promise<void> {
  const hasPerson = input.partyPersonId !== undefined && input.partyPersonId !== '';
  const hasName = !isBlank(input.partyName);
  if (!hasPerson && !hasName) throw new HebrewRefusal(PARTY_REFUSALS.neither);
  if (hasPerson && hasName) throw new HebrewRefusal(PARTY_REFUSALS.both);

  const [current] = await db.select({
    id: obligations.id, partyPersonId: obligations.partyPersonId,
  }).from(obligations).where(eq(obligations.id, input.obligationId));
  if (!current) throw new HebrewRefusal(`חוב לא קיים: ${input.obligationId}`);
  if (current.partyPersonId !== null) throw new HebrewRefusal(PARTY_REFUSALS.alreadyLinked);

  if (hasPerson) {
    const [person] = await db.select({
      id: persons.id, mergedIntoId: persons.mergedIntoId,
    }).from(persons).where(eq(persons.id, input.partyPersonId!));
    // A merged-away row is kept so the merge can be undone, but nothing new
    // may point at it: the debt would show on nobody's page.
    if (!person || person.mergedIntoId !== null) {
      throw new HebrewRefusal(PARTY_REFUSALS.noSuchPerson);
    }
    await db.update(obligations)
      .set({ partyPersonId: person.id })
      .where(eq(obligations.id, current.id));
    return;
  }

  await db.update(obligations)
    .set({ partyName: input.partyName! })
    .where(eq(obligations.id, current.id));
}
