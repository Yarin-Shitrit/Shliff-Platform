import { and, eq, ne, or } from 'drizzle-orm';
import type { Db } from '@/db';
import type { AnyDb } from '@/lib/db-types';
import {
  persons, personAliases, memberships, dues, payments, seasons, taskAssignments,
} from '@/db/schema/camp';
import { accounts, obligations } from '@/db/schema/money';
import { acquisitionItems, workItems } from '@/db/schema/logistics';

/** The same guard `link.ts` keeps: a pasted, truncated id must render
 *  nothing, not crash the screen with `invalid input syntax for type uuid`. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DeleteBlocker {
  /** The refusal, as a noun a lead reads: `תשלומים`, `שיבוץ למשימה`. */
  conflict: string;
  /** How many rows cause it. */
  count: number;
  /** Where a lead goes to unpick it, or null when there is nowhere to go. */
  href: string | null;
}

export interface DeletePreview {
  personId: string;
  displayName: string;
  /** Spellings a lead typed. They go with the record. */
  manualAliases: string[];
  /** Spellings that came out of a workbook. They go back to the queue of
   *  names waiting for a decision — evidence is never deleted. */
  importAliases: string[];
  /** The seasons whose roster the person leaves. */
  seasons: string[];
  /** Dues with no payment against them. A due with a payment is a blocker. */
  duesCount: number;
  /** Everything that stops the deletion, in the order a lead reads them.
   *  Empty means `deletePerson` will go ahead. */
  blockers: DeleteBlocker[];
}

export type DeleteResult =
  | { ok: true; removed: { aliases: number; requeued: number; memberships: number; dues: number } }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'blocked'; blockers: DeleteBlocker[] };

/**
 * Everything that stops a person being deleted, with where to go about it.
 *
 * The schema would let most of this through: `accounts`, `obligations` and
 * the logistics tables reference `persons` with `on delete set null`, so
 * deleting a payer turns `חוב יוסף 15,240` into a debt owed to nobody with
 * nothing on screen saying who it used to be. That is the system deciding
 * something on a lead's behalf, which it never does. So every row that
 * names this person is a refusal, and the lead resolves it by hand first —
 * the same rule `mergeConflicts` follows, for the same reason.
 *
 * The cascades are allowed through on purpose: a membership, an unpaid due
 * and the person's own spellings describe nobody once the person is gone.
 * A paid due is different — a payment is money that moved — so one payment
 * anywhere on the record blocks it.
 */
async function blockersFor(
  db: AnyDb, personId: string, mergedIntoId: string | null,
): Promise<DeleteBlocker[]> {
  const blockers: DeleteBlocker[] = [];

  /*
   * A merged record is kept so the merge can be undone (`unmergePerson`
   * finds the aliases by `merged_from_person_id`, which is this id). Deleting
   * it would leave those aliases pointing at nobody and the merge impossible
   * to reverse. The survivor is where the person now lives.
   */
  if (mergedIntoId !== null) {
    blockers.push({ conflict: 'רשומה ממוזגת', count: 1, href: `/members/${mergedIntoId}` });
  }

  const dueRows = await db.select({ id: dues.id }).from(dues).where(eq(dues.personId, personId));
  let paymentCount = 0;
  for (const due of dueRows) {
    const rows = await db.select({ id: payments.id }).from(payments).where(eq(payments.dueId, due.id));
    paymentCount += rows.length;
  }
  if (paymentCount > 0) {
    blockers.push({ conflict: 'תשלומים', count: paymentCount, href: `/members/${personId}?tab=payments` });
  }

  const assignmentRows = await db.select({ id: taskAssignments.id })
    .from(taskAssignments).where(eq(taskAssignments.personId, personId));
  if (assignmentRows.length > 0) {
    blockers.push({ conflict: 'שיבוץ למשימה', count: assignmentRows.length, href: `/members/${personId}?tab=tasks` });
  }

  const obligationRows = await db.select({ id: obligations.id })
    .from(obligations).where(eq(obligations.partyPersonId, personId));
  if (obligationRows.length > 0) {
    blockers.push({ conflict: 'חובות', count: obligationRows.length, href: '/money/debts' });
  }

  const accountRows = await db.select({ id: accounts.id })
    .from(accounts).where(eq(accounts.holderPersonId, personId));
  if (accountRows.length > 0) {
    blockers.push({ conflict: 'קופה', count: accountRows.length, href: '/money' });
  }

  /* No href: nothing offers an unmerge yet — see `unmergePerson`. A link that
     went nowhere useful would promise a fix that is not one click away. */
  const absorbedRows = await db.select({ id: persons.id })
    .from(persons).where(eq(persons.mergedIntoId, personId));
  if (absorbedRows.length > 0) {
    blockers.push({ conflict: 'מיזוג קודם', count: absorbedRows.length, href: null });
  }

  const acquisitionRows = await db.select({ id: acquisitionItems.id })
    .from(acquisitionItems)
    .where(or(
      eq(acquisitionItems.assigneePersonId, personId),
      eq(acquisitionItems.lenderPersonId, personId),
    ));
  if (acquisitionRows.length > 0) {
    blockers.push({ conflict: 'פריטי רכש', count: acquisitionRows.length, href: '/logistics/acquisitions' });
  }

  const workRows = await db.select({ id: workItems.id })
    .from(workItems).where(eq(workItems.assigneePersonId, personId));
  if (workRows.length > 0) {
    blockers.push({ conflict: 'לוח עבודה', count: workRows.length, href: '/logistics/plan' });
  }

  return blockers;
}

/**
 * What deleting this person would do, and everything standing in its way,
 * before anything is pressed.
 *
 * `deletePerson` calls this and refuses on its `blockers`, so the screen
 * cannot promise a deletion the library would refuse, and cannot describe a
 * removal it would not make. Null when the id names nobody: a delete URL is
 * pasteable, so a stale id in one is ordinary rather than an error.
 */
export async function previewDelete(db: AnyDb, personId: string): Promise<DeletePreview | null> {
  if (!UUID.test(personId)) return null;

  const [person] = await db.select({
    id: persons.id, displayName: persons.displayName, mergedIntoId: persons.mergedIntoId,
  }).from(persons).where(eq(persons.id, personId));
  if (!person) return null;

  const aliasRows = await db.select({ alias: personAliases.alias, source: personAliases.source })
    .from(personAliases).where(eq(personAliases.personId, personId));

  const seasonRows = await db
    .select({ name: seasons.name, year: seasons.year })
    .from(memberships)
    .innerJoin(seasons, eq(seasons.id, memberships.seasonId))
    .where(eq(memberships.personId, personId));

  const dueRows = await db.select({ id: dues.id }).from(dues).where(eq(dues.personId, personId));

  return {
    personId,
    displayName: person.displayName,
    manualAliases: aliasRows.filter((row) => row.source === 'manual').map((row) => row.alias).sort(),
    importAliases: aliasRows.filter((row) => row.source !== 'manual').map((row) => row.alias).sort(),
    seasons: seasonRows.sort((a, b) => a.year - b.year).map((row) => row.name),
    duesCount: dueRows.length,
    blockers: await blockersFor(db, personId, person.mergedIntoId),
  };
}

/**
 * Deletes a person.
 *
 * Permitted only when nothing but the record itself would be lost: the
 * person's own spellings, their memberships and dues nobody has paid. Every
 * other row that names them is a blocker, returned so a lead can resolve it
 * by hand — see `blockersFor` for why the schema's `set null` is not taken
 * up on.
 *
 * Workbook spellings are not deleted with the record. They go back to the
 * queue of names waiting for a decision, cleared of the confirmation that
 * pointed them here: the name is still in the camp's files, and the next
 * import would only put it back in the queue anyway. A manual spelling is
 * what a lead typed when they created the record, so it goes with it.
 *
 * In a transaction, because the failure it prevents is concrete: the
 * spellings requeued, the delete refused by the driver, and a person who
 * still exists with no spelling left to find them by. The cast is the one
 * `recordArrival` and `promote.ts` use — `Db` and `TestDb` each type
 * `.transaction()` against their own driver.
 */
export async function deletePerson(db: AnyDb, personId: string): Promise<DeleteResult> {
  return (db as Db).transaction(async (tx) => {
    const scoped = tx as unknown as AnyDb;

    const preview = await previewDelete(scoped, personId);
    if (preview === null) return { ok: false, reason: 'not-found' } as const;
    if (preview.blockers.length > 0) {
      return { ok: false, reason: 'blocked', blockers: preview.blockers } as const;
    }

    const manualRows = await scoped.select({ id: personAliases.id })
      .from(personAliases)
      .where(and(eq(personAliases.personId, personId), eq(personAliases.source, 'manual')));

    const requeued = await scoped.update(personAliases)
      .set({ personId: null, confirmedBy: null, confirmedAt: null, mergedFromPersonId: null })
      .where(and(eq(personAliases.personId, personId), ne(personAliases.source, 'manual')))
      .returning();

    const membershipRows = await scoped.select({ id: memberships.id })
      .from(memberships).where(eq(memberships.personId, personId));

    await scoped.delete(persons).where(eq(persons.id, personId));

    return {
      ok: true,
      removed: {
        aliases: manualRows.length,
        requeued: requeued.length,
        memberships: membershipRows.length,
        dues: preview.duesCount,
      },
    } as const;
  });
}
