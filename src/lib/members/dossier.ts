import { asc, eq, isNull } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import {
  persons, personAliases, memberships, seasons, dues,
} from '@/db/schema/camp';
import type { DueKind } from '@/db/schema/camp';
import { settlementFor } from '@/lib/fees/payments';
import { responsibilitiesOf, type Responsibility } from '@/lib/work/coverage';
import { toAgorot } from '@/lib/money';

export interface DossierDue {
  dueId: string;
  seasonName: string;
  amountAgorot: number;
  kind: DueKind;
  exceptionReason: string | null;
  decidedBy: string | null;
  paidAgorot: number;
  outstandingAgorot: number;
  settled: boolean;
}

export interface Dossier {
  personId: string;
  displayName: string;
  notes: string | null;
  mergedIntoId: string | null;
  aliases: Array<{ aliasId: string; alias: string; source: string; confirmedBy: string | null }>;
  seasons: Array<{ seasonId: string; seasonName: string; role: string }>;
  dues: DossierDue[];
  responsibilities: Responsibility[];
}

export interface PersonSummary {
  personId: string;
  displayName: string;
  aliasCount: number;
  seasonCount: number;
  outstandingAgorot: number;
}

/** Everything the system knows about one human, in one call. */
export async function personDossier(
  db: AnyDb, personId: string,
): Promise<Dossier | null> {
  const [person] = await db.select().from(persons).where(eq(persons.id, personId));
  if (!person) return null;

  const aliases = await db
    .select({
      aliasId: personAliases.id,
      alias: personAliases.alias,
      source: personAliases.source,
      confirmedBy: personAliases.confirmedBy,
    })
    .from(personAliases)
    .where(eq(personAliases.personId, personId))
    .orderBy(asc(personAliases.alias));

  const seasonRows = await db
    .select({ seasonId: seasons.id, seasonName: seasons.name, role: memberships.role })
    .from(memberships)
    .innerJoin(seasons, eq(seasons.id, memberships.seasonId))
    .where(eq(memberships.personId, personId))
    .orderBy(asc(seasons.year));

  const dueRows = await db
    .select({
      dueId: dues.id,
      seasonName: seasons.name,
      amount: dues.amount,
      kind: dues.kind,
      exceptionReason: dues.exceptionReason,
      decidedBy: dues.decidedBy,
    })
    .from(dues)
    .innerJoin(seasons, eq(seasons.id, dues.seasonId))
    .where(eq(dues.personId, personId))
    .orderBy(asc(seasons.year));

  const dueDetails: DossierDue[] = [];
  for (const row of dueRows) {
    const settlement = await settlementFor(db, row.dueId);
    dueDetails.push({
      dueId: row.dueId,
      seasonName: row.seasonName,
      amountAgorot: toAgorot(row.amount),
      kind: row.kind,
      exceptionReason: row.exceptionReason,
      decidedBy: row.decidedBy,
      paidAgorot: settlement.paidAgorot,
      outstandingAgorot: settlement.outstandingAgorot,
      settled: settlement.settled,
    });
  }

  return {
    personId: person.id,
    displayName: person.displayName,
    notes: person.notes,
    mergedIntoId: person.mergedIntoId,
    aliases,
    seasons: seasonRows,
    dues: dueDetails,
    responsibilities: await responsibilitiesOf(db, personId),
  };
}

/** The roster index. Merged-away rows are hidden; their aliases live on the
 *  person they were merged into. */
export async function listPeople(db: AnyDb): Promise<PersonSummary[]> {
  const people = await db.select().from(persons)
    .where(isNull(persons.mergedIntoId))
    .orderBy(asc(persons.displayName));

  const summaries: PersonSummary[] = [];
  for (const person of people) {
    const aliases = await db.select({ id: personAliases.id }).from(personAliases)
      .where(eq(personAliases.personId, person.id));
    const seasonRows = await db.select({ id: memberships.id }).from(memberships)
      .where(eq(memberships.personId, person.id));
    const dueRows = await db.select({ id: dues.id }).from(dues)
      .where(eq(dues.personId, person.id));

    let outstandingAgorot = 0;
    for (const due of dueRows) {
      outstandingAgorot += (await settlementFor(db, due.id)).outstandingAgorot;
    }

    summaries.push({
      personId: person.id,
      displayName: person.displayName,
      aliasCount: aliases.length,
      seasonCount: seasonRows.length,
      outstandingAgorot,
    });
  }
  return summaries;
}
