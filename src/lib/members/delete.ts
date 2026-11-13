import { and, eq, ne, or, inArray } from 'drizzle-orm';
import type { Db } from '@/db';
import type { AnyDb } from '@/lib/db-types';
import {
  persons, personAliases, memberships, dues, payments, seasons, tasks, taskAssignments,
} from '@/db/schema/camp';
import { accounts, obligations, obligationSettlements } from '@/db/schema/money';
import { acquisitionItems, workItems } from '@/db/schema/logistics';
import { toAgorot, formatILS, SHEKEL } from '@/lib/money';
import { formatDateShort } from '@/lib/dates';

/** The same guard `link.ts` keeps: a pasted, truncated id must render
 *  nothing, not crash the screen with `invalid input syntax for type uuid`. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One row that names the person, and the control that can stop it doing so. */
export interface DeleteBlockerItem {
  /** `ברן 26 · 500 ₪ · ביט · 01/05/26` — enough to find the row by eye. */
  label: string;
  /** The drawer or board where this one row is unpicked. Null when the app
   *  has no control for it yet, and the step's `action` says what to do
   *  instead. */
  href: string | null;
}

export interface DeleteBlocker {
  /** The refusal, as a noun a lead reads: `תשלומים`, `שיבוץ למשימה`. */
  conflict: string;
  /** How many rows cause it. */
  count: number;
  /** Where a lead goes to unpick it — the first item's own link, or the
   *  screen when there is no per-row control — or null when there is
   *  nowhere to go. */
  href: string | null;
  /** What to do there, in the words the control uses, so a lead can follow
   *  it without guessing: which field, which button, what happens. */
  action: string;
  /** Every row behind the count, each with its own way in. */
  items: DeleteBlockerItem[];
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

/** `?season=<id>&` when the screen is season-scoped and the row has one. */
function seasonQuery(seasonId: string | null): string {
  return seasonId === null ? '' : `season=${seasonId}&`;
}

function money(amount: string): string {
  return `${formatILS(toAgorot(amount))} ${SHEKEL}`;
}

/**
 * Everything that stops a person being deleted, with where to go about it
 * and what to do there.
 *
 * The schema would let most of this through: `accounts`, `obligations` and
 * the logistics tables reference `persons` with `on delete set null`, so
 * deleting a payer turns `חוב יוסף 15,240` into a debt owed to nobody with
 * nothing on screen saying who it used to be. That is the system deciding
 * something on a lead's behalf, which it never does. So every row that
 * names this person is a refusal, and the lead resolves it by hand first —
 * the same rule `mergeConflicts` follows, for the same reason.
 *
 * Each refusal names its rows one by one, with the link that opens the
 * control for that row: the payment drawer of that season, the shift's own
 * drawer, the debt's drawer, the account's holder drawer, the item's edit
 * drawer. A blocker that only said "payments · 2" sent a lead to a tab with
 * no control on it, and the two things that could not be unpicked anywhere
 * (a debt's person, an account's holder) looked exactly like the ones that
 * could.
 *
 * The cascades are allowed through on purpose: a membership, an unpaid due
 * and the person's own spellings describe nobody once the person is gone.
 * A paid due is different — a payment is money that moved — so one payment
 * anywhere on the record blocks it.
 */
async function blockersFor(
  db: AnyDb, personId: string, displayName: string, mergedIntoId: string | null,
): Promise<DeleteBlocker[]> {
  const blockers: DeleteBlocker[] = [];

  /*
   * A merged record is kept so the merge can be undone (`unmergePerson`
   * finds the aliases by `merged_from_person_id`, which is this id). Deleting
   * it would leave those aliases pointing at nobody and the merge impossible
   * to reverse. The survivor is where the person now lives; the unmerge
   * control is on this record, because this is the record it restores.
   */
  if (mergedIntoId !== null) {
    const [survivor] = await db.select({ displayName: persons.displayName })
      .from(persons).where(eq(persons.id, mergedIntoId));
    const survivorName = survivor?.displayName ?? 'אדם אחר';
    blockers.push({
      conflict: 'רשומה ממוזגת',
      count: 1,
      href: `/members/${personId}?unmerge=1`,
      action: `הרשומה הזו מוזגה לתוך ${survivorName}, ושם האדם רשום עכשיו. כדי למחוק אותה לוחצים ״ביטול המיזוג״ בראש העמוד: הכינויים שעברו חוזרים לכאן, והרשומה שוב עומדת בפני עצמה. אחרי זה אפשר למחוק.`,
      items: [{ label: `מוזגה לתוך ${survivorName}`, href: `/members/${mergedIntoId}` }],
    });
  }

  const paymentRows = await db
    .select({
      amount: payments.amount,
      channel: payments.channel,
      paidOn: payments.paidOn,
      seasonId: seasons.id,
      seasonName: seasons.name,
    })
    .from(payments)
    .innerJoin(dues, eq(dues.id, payments.dueId))
    .innerJoin(seasons, eq(seasons.id, dues.seasonId))
    .where(eq(dues.personId, personId))
    .orderBy(seasons.year, payments.paidOn);
  if (paymentRows.length > 0) {
    /* The payment drawer on /fees opens from the season's roster, so a
       payment in a season the person is no longer listed in has no drawer
       to open — the step says to list them first. */
    const memberOf = new Set((await db.select({ seasonId: memberships.seasonId })
      .from(memberships).where(eq(memberships.personId, personId)))
      .map((row) => row.seasonId));
    const items = paymentRows.map((row) => {
      const listed = memberOf.has(row.seasonId);
      return {
        label: `${row.seasonName} · ${money(row.amount)} · ${row.channel} · ${formatDateShort(row.paidOn)}`
          + (listed ? '' : ` · לא ברשימת ${row.seasonName}`),
        href: listed ? `/fees?season=${row.seasonId}&peek=${personId}&act=pay` : null,
      };
    });
    const unlisted = items.some((item) => item.href === null);
    blockers.push({
      conflict: 'תשלומים',
      count: paymentRows.length,
      href: items.find((item) => item.href !== null)?.href ?? null,
      action: 'תשלום הוא כסף שעבר, ולכן הוא לא נמחק יחד עם האדם. אם הכסף באמת התקבל, כנראה שהרשומה צריכה מיזוג ולא מחיקה. אם התשלום נרשם בטעות: פותחים את חלון התשלום של האדם בדמי קאמפ של אותה שנה, ותחת ״תשלומים קודמים״ לוחצים הסרה ליד כל תשלום ומאשרים ״מחיקת התשלום״.'
        + (unlisted ? ' תשלום בשנה שהאדם כבר לא ברשימתה: מוסיפים אותו לרשימת אותה שנה (״הוספה לשנה״ בעמוד הזה), מסירים את התשלום, ואז מוחקים.' : ''),
      items,
    });
  }

  const assignmentRows = await db
    .select({
      status: taskAssignments.status,
      taskId: tasks.id,
      title: tasks.title,
      kind: tasks.kind,
      taskStatus: tasks.status,
      startsAt: tasks.startsAt,
      endsAt: tasks.endsAt,
      seasonId: seasons.id,
      seasonName: seasons.name,
      seasonStartsOn: seasons.startsOn,
    })
    .from(taskAssignments)
    .innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
    .innerJoin(seasons, eq(seasons.id, tasks.seasonId))
    .where(eq(taskAssignments.personId, personId))
    .orderBy(seasons.year, tasks.title);
  if (assignmentRows.length > 0) {
    const items = assignmentRows.map((row) => {
      /* The shifts screen draws its schedule only once the season has a gate
         date, and opens its drawer only from that schedule; before that, a
         link to it lands on a page with nothing to open. The board offers
         the same removal for every open task, whatever its kind. */
      const onSchedule = row.kind === 'shift' && row.taskStatus !== 'cancelled'
        && row.startsAt !== null && row.endsAt !== null && row.seasonStartsOn !== null;
      const notes = [
        row.status === 'dropped' ? 'שיבוץ שבוטל' : null,
        row.taskStatus === 'done' ? 'משימה שבוצעה' : row.taskStatus === 'cancelled' ? 'משימה שבוטלה' : null,
      ].filter((note): note is string => note !== null);
      return {
        label: [row.title, row.seasonName, ...notes].join(' · '),
        href: onSchedule
          ? `/logistics/shifts?season=${row.seasonId}&peek=${row.taskId}`
          : `/tasks?season=${row.seasonId}`,
      };
    });
    blockers.push({
      conflict: 'שיבוץ למשימה',
      count: assignmentRows.length,
      href: items[0].href,
      action: 'בלוח המשימות של אותה שנה מוצאים את שורת המשימה, לוחצים על ״שיבוץ״ ובחלון שנפתח לוחצים הסרה ליד השם ומאשרים ״הסרת השיבוץ״. משימה שסומנה כבוצעה או בוטלה לא מציעה שיבוץ — פותחים אותה מחדש מתפריט ״אפשרויות״, מסירים, וסוגרים שוב. משמרת של שנה שכבר נקבע לה תאריך פתיחת שער נפתחת ישירות בלוח המשמרות, ושם מסירים את האדם מהמשמרת.',
      items,
    });
  }

  const obligationRows = await db
    .select({
      id: obligations.id,
      description: obligations.description,
      amount: obligations.amount,
      seasonId: obligations.seasonId,
    })
    .from(obligations)
    .where(eq(obligations.partyPersonId, personId))
    .orderBy(obligations.openedOn);
  if (obligationRows.length > 0) {
    const settledRows = await db
      .select({ obligationId: obligationSettlements.obligationId, amount: obligationSettlements.amount })
      .from(obligationSettlements)
      .where(inArray(obligationSettlements.obligationId, obligationRows.map((row) => row.id)));
    const settledAgorot = new Map<string, number>();
    for (const row of settledRows) {
      settledAgorot.set(row.obligationId, (settledAgorot.get(row.obligationId) ?? 0) + toAgorot(row.amount));
    }
    const items = obligationRows.map((row) => {
      const settled = (settledAgorot.get(row.id) ?? 0) >= toAgorot(row.amount);
      return {
        label: `${row.description} · ${money(row.amount)}${settled ? ' · נסגר' : ''}`,
        href: `/money/debts?${seasonQuery(row.seasonId)}peek=${row.id}${settled ? '&view=settled' : ''}`,
      };
    });
    blockers.push({
      conflict: 'חובות',
      count: obligationRows.length,
      href: items[0].href,
      action: `חוב לא נמחק ולא מועבר. בחלון החוב לוחצים ״ניתוק מהאדם״: החוב נשאר רשום בדיוק כמו שהוא, על השם שנכתב עליו במקור כטקסט חופשי (ואם לא נכתב עליו שם — על השם ${displayName}), רק בלי קישור לרשומה הזו. חוב שכבר נסגר נמצא בתצוגת ״נסגרו״ ומנתקים אותו באותו אופן.`,
      items,
    });
  }

  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name, closedAt: accounts.closedAt })
    .from(accounts).where(eq(accounts.holderPersonId, personId)).orderBy(accounts.name);
  if (accountRows.length > 0) {
    const items = accountRows.map((row) => ({
      label: `${row.name}${row.closedAt === null ? '' : ' · חשבון סגור'}`,
      href: `/money?act=holder&account=${row.id}`,
    }));
    blockers.push({
      conflict: 'קופה',
      count: accountRows.length,
      href: items[0].href,
      action: 'קופה לא נמחקת. בכרטיס החשבון בעמוד הכספים לוחצים ״מי מחזיק/ה״ ובוחרים מי מחזיק את הכסף עכשיו — אדם אחר מהרשימה, או ״אף אחד״ — ולוחצים שמירה.',
      items,
    });
  }

  /*
   * The unmerge control lives on the absorbed record (it is the record it
   * restores), so each item here is a way into that record with the
   * confirmation already open.
   */
  const absorbedRows = await db.select({ id: persons.id, displayName: persons.displayName })
    .from(persons).where(eq(persons.mergedIntoId, personId)).orderBy(persons.displayName);
  if (absorbedRows.length > 0) {
    const items = absorbedRows.map((row) => ({
      label: row.displayName,
      href: `/members/${row.id}?unmerge=1`,
    }));
    blockers.push({
      conflict: 'מיזוג קודם',
      count: absorbedRows.length,
      href: items[0].href,
      action: absorbedRows.length === 1
        ? 'רשומה אחת מוזגה לתוך האדם הזה, והמיזוג חייב להיות הפיך. פותחים אותה ולוחצים ״ביטול המיזוג״: הכינויים שעברו חוזרים אליה, והיא שוב רשומה נפרדת. אחרי זה אפשר למחוק כאן.'
        : `${absorbedRows.length} רשומות מוזגו לתוך האדם הזה, והמיזוג חייב להיות הפיך. פותחים כל אחת מהן ולוחצים ״ביטול המיזוג״: הכינויים שעברו חוזרים אליה, והיא שוב רשומה נפרדת. אחרי זה אפשר למחוק כאן.`,
      items,
    });
  }

  const acquisitionRows = await db
    .select({
      id: acquisitionItems.id,
      name: acquisitionItems.name,
      seasonId: acquisitionItems.seasonId,
      assigneePersonId: acquisitionItems.assigneePersonId,
      lenderPersonId: acquisitionItems.lenderPersonId,
    })
    .from(acquisitionItems)
    .where(or(
      eq(acquisitionItems.assigneePersonId, personId),
      eq(acquisitionItems.lenderPersonId, personId),
    ))
    .orderBy(acquisitionItems.name);
  if (acquisitionRows.length > 0) {
    const items = acquisitionRows.map((row) => {
      const roles = [
        row.assigneePersonId === personId ? 'אחראי/ת' : null,
        row.lenderPersonId === personId ? 'משאיל/ה' : null,
      ].filter((role): role is string => role !== null);
      return {
        label: `${row.name} · ${roles.join(' ו')}`,
        href: `/logistics/acquisitions?${seasonQuery(row.seasonId)}peek=${row.id}`,
      };
    });
    blockers.push({
      conflict: 'פריטי רכש',
      count: acquisitionRows.length,
      href: items[0].href,
      action: 'פריט רכש לא נמחק. בחלון הפריט מחליפים את ״מי אחראי להשיג״ לאדם אחר או ל״אין אחראי עדיין״ ולוחצים שמירה. פריט מושאל: מחליפים את ״ממי משאילים״ לאדם אחר, או משנים את ״דרך ההשגה״ כך שאין משאיל.',
      items,
    });
  }

  const workRows = await db
    .select({
      id: workItems.id,
      title: workItems.title,
      seasonId: workItems.seasonId,
      acquisitionItemId: workItems.acquisitionItemId,
      acquisitionSeasonId: acquisitionItems.seasonId,
    })
    .from(workItems)
    .leftJoin(acquisitionItems, eq(acquisitionItems.id, workItems.acquisitionItemId))
    .where(eq(workItems.assigneePersonId, personId))
    .orderBy(workItems.title);
  if (workRows.length > 0) {
    /* A line made from a purchase follows the purchase: its person is set
       on רכש and overwritten from there on every save, so the link goes to
       the purchase rather than to a field the plan's drawer disables. */
    const items = workRows.map((row) => (row.acquisitionItemId === null
      ? {
        label: row.title,
        href: `/logistics/plan?season=${row.seasonId}&peek=${row.id}`,
      }
      : {
        label: `${row.title} · עוקב אחרי פריט ברכש`,
        href: `/logistics/acquisitions?${seasonQuery(row.acquisitionSeasonId)}peek=${row.acquisitionItemId}`,
      }));
    const linked = workRows.some((row) => row.acquisitionItemId !== null);
    blockers.push({
      conflict: 'לוח עבודה',
      count: workRows.length,
      href: items[0].href,
      action: 'שורה בלוח העבודה לא נמחקת. בחלון השורה מחליפים את ״אחראי״ לאדם אחר או ל״עדיין לא נקבע״ ולוחצים שמירה.'
        + (linked ? ' שורה שעוקבת אחרי פריט ברכש מקבלת את האחראי מהפריט — הקישור פותח את הפריט ברשימת הרכש, ושם מחליפים.' : ''),
      items,
    });
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
    blockers: await blockersFor(db, personId, person.displayName, person.mergedIntoId),
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
