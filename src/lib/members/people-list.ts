import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import {
  persons, personAliases, memberships, seasons, dues, payments,
  tasks, taskAssignments,
} from '@/db/schema/camp';
import type { DueKind } from '@/db/schema/camp';
import { toAgorot } from '@/lib/money';

export type DuesState = 'paid' | 'offset' | 'partial' | 'unpaid' | 'exempt' | 'none';

export interface PersonSeason {
  seasonId: string;
  name: string;
  year: number;
  role: string;
}

export interface PersonDues {
  dueId: string;
  amountAgorot: number;
  paidAgorot: number;
  outstandingAgorot: number;
  kind: DueKind;
  exceptionReason: string | null;
  state: DuesState;
}

export interface PersonListRow {
  personId: string;
  displayName: string;
  /** Every spelling but the display name, alphabetical. */
  aliases: string[];
  /** Role on the scope season; null when not on it. */
  role: string | null;
  /** Ascending by year. The year chips read straight off this. */
  seasons: PersonSeason[];
  /** The scope season's due. Null when there is no scope season, when the
   *  person is not on it, or when no due has been issued to them there. */
  dues: PersonDues | null;
  /** Outstanding across every season — one meaning in every view. */
  outstandingAgorot: number;
  /** Live assignments on scope-season tasks. Zero when there is no scope. */
  taskCount: number;
  /** The newest stamp on anything belonging to this person. Never null:
   *  `persons.createdAt` is the floor. */
  lastActivityAt: Date;
  onScopeSeason: boolean;
  /** On the scope season and on no earlier one. */
  newThisSeason: boolean;
  /** On the previous season by year, and not on the scope season. */
  lapsed: boolean;
}

/**
 * A due settled entirely by קיזוז is reported as `offset`, not as `paid`.
 * Both mean the debt is closed, but one of them means no cash ever arrived,
 * and a lead reconciling a קופה needs to be able to tell them apart from the
 * roster without opening the person.
 *
 * `exempt` is checked first because a zero-amount exception satisfies
 * `paid >= amount` trivially and would otherwise be reported as an offset
 * settlement of nothing.
 */
function duesState(
  amountAgorot: number, paidAgorot: number, cashAgorot: number, kind: DueKind,
): DuesState {
  if (kind === 'exception' && amountAgorot === 0) return 'exempt';
  if (paidAgorot >= amountAgorot) return cashAgorot === 0 ? 'offset' : 'paid';
  if (paidAgorot > 0) return 'partial';
  return 'unpaid';
}

function newest(current: Date, candidate: Date | null): Date {
  if (!candidate) return current;
  return candidate > current ? candidate : current;
}

/**
 * Every column `/members` shows, for every person, in seven statements.
 *
 * Replaces `listPeople` for the roster screen: that one issues three queries
 * and a settlement per person and still cannot say what role anyone holds or
 * whether they have paid. It stays in the tree only because `/tasks` still
 * calls it.
 *
 * `seasonId` may be null — the כולם view is camp-wide, and a person who is on
 * no season is still a person. With no scope season, `dues` is null and
 * `taskCount` is zero for everyone, and neither `newThisSeason` nor `lapsed`
 * can be decided, so both are false.
 */
export async function listPeopleForSeason(
  db: AnyDb, seasonId: string | null,
): Promise<PersonListRow[]> {
  const allSeasons = await db.select().from(seasons).orderBy(asc(seasons.year));
  const scope = seasonId ? allSeasons.find((s) => s.id === seasonId) ?? null : null;
  const previous = scope
    ? allSeasons.filter((s) => s.year < scope.year).at(-1) ?? null
    : null;

  const people = await db
    .select({
      id: persons.id,
      displayName: persons.displayName,
      createdAt: persons.createdAt,
    })
    .from(persons)
    .where(isNull(persons.mergedIntoId))
    .orderBy(asc(persons.displayName));

  const aliasRows = await db
    .select({
      personId: personAliases.personId,
      alias: personAliases.alias,
      confirmedAt: personAliases.confirmedAt,
    })
    .from(personAliases)
    .innerJoin(persons, eq(persons.id, personAliases.personId))
    .where(isNull(persons.mergedIntoId))
    .orderBy(asc(personAliases.alias));

  const membershipRows = await db
    .select({
      personId: memberships.personId,
      seasonId: memberships.seasonId,
      role: memberships.role,
      joinedAt: memberships.joinedAt,
    })
    .from(memberships);

  const dueRows = await db
    .select({
      dueId: dues.id,
      personId: dues.personId,
      seasonId: dues.seasonId,
      amount: dues.amount,
      kind: dues.kind,
      exceptionReason: dues.exceptionReason,
    })
    .from(dues);

  const paymentRows = await db
    .select({
      dueId: payments.dueId,
      amount: payments.amount,
      channel: payments.channel,
      createdAt: payments.createdAt,
    })
    .from(payments);

  const assignmentRows = await db
    .select({
      personId: taskAssignments.personId,
      seasonId: tasks.seasonId,
      createdAt: taskAssignments.createdAt,
    })
    .from(taskAssignments)
    .innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
    .where(and(
      ne(taskAssignments.status, 'dropped'),
      ne(tasks.status, 'cancelled'),
    ));

  const seasonById = new Map(allSeasons.map((s) => [s.id, s]));

  const paidByDue = new Map<string, number>();
  const cashByDue = new Map<string, number>();
  const paidAtByDue = new Map<string, Date>();
  for (const row of paymentRows) {
    const agorot = toAgorot(row.amount);
    paidByDue.set(row.dueId, (paidByDue.get(row.dueId) ?? 0) + agorot);
    if (row.channel !== 'קיזוז') {
      cashByDue.set(row.dueId, (cashByDue.get(row.dueId) ?? 0) + agorot);
    }
    paidAtByDue.set(row.dueId, newest(
      paidAtByDue.get(row.dueId) ?? row.createdAt, row.createdAt,
    ));
  }

  const aliasesByPerson = new Map<string, string[]>();
  const aliasStampByPerson = new Map<string, Date | null>();
  for (const row of aliasRows) {
    const id = row.personId as string;
    const list = aliasesByPerson.get(id) ?? [];
    list.push(row.alias);
    aliasesByPerson.set(id, list);
    if (row.confirmedAt) {
      aliasStampByPerson.set(id, newest(
        aliasStampByPerson.get(id) ?? row.confirmedAt, row.confirmedAt,
      ));
    }
  }

  const membershipsByPerson = new Map<string, typeof membershipRows>();
  for (const row of membershipRows) {
    const list = membershipsByPerson.get(row.personId) ?? [];
    list.push(row);
    membershipsByPerson.set(row.personId, list);
  }

  const duesByPerson = new Map<string, typeof dueRows>();
  for (const row of dueRows) {
    const list = duesByPerson.get(row.personId) ?? [];
    list.push(row);
    duesByPerson.set(row.personId, list);
  }

  const assignmentsByPerson = new Map<string, typeof assignmentRows>();
  for (const row of assignmentRows) {
    const list = assignmentsByPerson.get(row.personId) ?? [];
    list.push(row);
    assignmentsByPerson.set(row.personId, list);
  }

  return people.map((person) => {
    const own = membershipsByPerson.get(person.id) ?? [];
    const personSeasons: PersonSeason[] = own
      .map((row) => {
        const season = seasonById.get(row.seasonId);
        return season
          ? { seasonId: season.id, name: season.name, year: season.year, role: row.role }
          : null;
      })
      .filter((s): s is PersonSeason => s !== null)
      .sort((a, b) => a.year - b.year);

    const onScope = scope !== null && personSeasons.some((s) => s.seasonId === scope.id);
    const scopeMembership = scope
      ? personSeasons.find((s) => s.seasonId === scope.id) ?? null
      : null;

    let outstandingAgorot = 0;
    let scopeDues: PersonDues | null = null;
    for (const due of duesByPerson.get(person.id) ?? []) {
      const amountAgorot = toAgorot(due.amount);
      const paidAgorot = paidByDue.get(due.dueId) ?? 0;
      const outstanding = Math.max(0, amountAgorot - paidAgorot);
      outstandingAgorot += outstanding;
      if (scope && due.seasonId === scope.id) {
        scopeDues = {
          dueId: due.dueId,
          amountAgorot,
          paidAgorot,
          outstandingAgorot: outstanding,
          kind: due.kind,
          exceptionReason: due.exceptionReason,
          state: duesState(
            amountAgorot, paidAgorot, cashByDue.get(due.dueId) ?? 0, due.kind,
          ),
        };
      }
    }

    const assignments = assignmentsByPerson.get(person.id) ?? [];
    const taskCount = scope
      ? assignments.filter((row) => row.seasonId === scope.id).length
      : 0;

    let lastActivityAt = person.createdAt;
    lastActivityAt = newest(lastActivityAt, aliasStampByPerson.get(person.id) ?? null);
    for (const row of own) lastActivityAt = newest(lastActivityAt, row.joinedAt);
    for (const row of assignments) lastActivityAt = newest(lastActivityAt, row.createdAt);
    for (const due of duesByPerson.get(person.id) ?? []) {
      lastActivityAt = newest(lastActivityAt, paidAtByDue.get(due.dueId) ?? null);
    }

    return {
      personId: person.id,
      displayName: person.displayName,
      aliases: (aliasesByPerson.get(person.id) ?? [])
        .filter((alias) => alias !== person.displayName),
      role: scopeMembership?.role ?? null,
      seasons: personSeasons,
      dues: onScope ? scopeDues : null,
      outstandingAgorot,
      taskCount,
      lastActivityAt,
      onScopeSeason: onScope,
      newThisSeason: onScope && !personSeasons.some((s) => scope !== null && s.year < scope.year),
      lapsed: previous !== null
        && !onScope
        && personSeasons.some((s) => s.seasonId === previous.id),
    };
  });
}
