import type { AnyDb } from '@/lib/db-types';
import { createSeason, getSeasonByName, addMember } from '@/lib/members/roster';
import { resolveName, recordUnlinkedName } from '@/lib/members/identity';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues, listDues, setException } from '@/lib/fees/dues';
import { recordOffset, settlementFor } from '@/lib/fees/payments';
import { createEvent, listEvents } from '@/lib/work/events';
import { createTask, listTasks } from '@/lib/work/tasks';
import { assignPerson, setAssignmentStatus } from '@/lib/work/coverage';

export interface CampSeedResult {
  seasons: number;
  events: number;
  people: number;
  tasks: number;
}

/** Named in `תקציב קאמפ ברן 25` as `חריגים`, with their amounts. */
const BURN_25_EXCEPTIONS: Array<[string, number]> = [
  ['עזריאל', 1000],
  ['עדי', 1000],
  ['דניאל פינטו', 555],
  ['דנה שרון', 1400],
  ['עמירם דהן', 0],
];

/** Named in the ברן 25 reimbursement column, and in the רחבה `אחראי` column. */
const BURN_25_NAMED = [
  'אורי', 'לטם', 'אופק', 'תומר גולן', 'טלי', 'שימי', 'איתן', 'יובי',
  'עמי', 'נטלי', 'ראנצ׳ו', 'אלפר', 'רן', 'דניאל ענבר',
];

/** Marked `שולם` under `דמי קאמפ` in the ברן 26 sheet. Their dues were settled
 *  by the 6,000 offset line in the `קיזוזים` table under `חוב יוסף`. */
const BURN_26_OFFSET_MEMBERS = ['יוסף', 'קארינה', 'יונתן', 'ירין', 'עילאי'];

/** The `אחראי` column of `תקציב רחבה ברן 25`. `מייצג` is deliberately left
 *  unassigned: its owner cell reads `ראנצ׳ו ונטלי`, two names in one string. */
const BURN_25_DELIVERABLES: Array<{ title: string; budget: number; owner?: string }> = [
  { title: 'מייצג', budget: 41300 },
  { title: 'חשמל', budget: 12950, owner: 'אופק' },
  { title: 'הגברה + תאורה', budget: 30810, owner: 'עמי' },
  { title: 'הובלה', budget: 4000, owner: 'אופק' },
];

const BURN_25_EVENTS = ['House of trance 270925', 'Halloween Underground 311025'];
const BURN_26_EVENTS = ['מסיבת פקאנים', 'SuperNature 18.7', 'SuperNature 3.10'];

/** Creates a person only if no linked alias already resolves to one. */
async function ensurePerson(
  db: AnyDb, name: string, email: string, counter: { people: number },
): Promise<string> {
  const existing = await resolveName(db, name);
  if (existing.personId) return existing.personId;
  counter.people += 1;
  return createPerson(db, name, email);
}

/**
 * Seeds the roster, dues and work the workbooks actually record.
 *
 * Deliberately partial. Three things are NOT seeded, each for the same reason:
 * the system does not invent what the source does not say.
 *  - ברן 23 and ברן 24 have no recorded flat rate, so they are not created.
 *  - The 38 anonymous `רגילים` are a count in a budget cell, not a roster;
 *    `plannedSize` carries the number instead.
 *  - `ראנצ׳ו ונטלי` is queued as an unlinked name rather than split into one
 *    or two people. A lead decides.
 *
 * Idempotent: safe to run against a database that already has some of this.
 */
export async function seedCampBaseline(
  db: AnyDb, email: string,
): Promise<CampSeedResult> {
  const result: CampSeedResult = { seasons: 0, events: 0, people: 0, tasks: 0 };
  const counter = { people: 0 };

  let s25 = await getSeasonByName(db, 'ברן 25');
  if (!s25) {
    s25 = await createSeason(db, {
      name: 'ברן 25', year: 2025, flatRate: 1500, plannedSize: 43,
    });
    result.seasons += 1;
  }
  let s26 = await getSeasonByName(db, 'ברן 26');
  if (!s26) {
    s26 = await createSeason(db, {
      name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35,
    });
    result.seasons += 1;
  }

  const existingEvents = new Set([
    ...(await listEvents(db, s25.id)).map((e) => e.name),
    ...(await listEvents(db, s26.id)).map((e) => e.name),
  ]);
  for (const [season, names] of [[s25, BURN_25_EVENTS], [s26, BURN_26_EVENTS]] as const) {
    for (const name of names) {
      if (existingEvents.has(name)) continue;
      await createEvent(db, { seasonId: season.id, name, kind: 'fundraiser' });
      result.events += 1;
    }
  }

  // ברן 25 roster: everyone the sheets name. The 38 anonymous רגילים are not people.
  for (const name of [...BURN_25_NAMED, ...BURN_25_EXCEPTIONS.map(([n]) => n)]) {
    const personId = await ensurePerson(db, name, email, counter);
    await addMember(db, personId, s25.id);
  }
  await issueFlatDues(db, s25.id);

  const dues25 = await listDues(db, s25.id);
  for (const [name, amount] of BURN_25_EXCEPTIONS) {
    const row = dues25.find((d) => d.displayName === name);
    if (!row || row.kind === 'exception') continue;
    await setException(db, {
      personId: row.personId,
      seasonId: s25.id,
      amount,
      reason: 'חריג מתוך `תקציב קאמפ ברן 25` — הסכום נרשם, הסיבה לא תועדה במקור',
      decidedBy: email,
    });
  }

  // ברן 26: the five whose dues were settled by the 6,000 offset.
  for (const name of BURN_26_OFFSET_MEMBERS) {
    const personId = await ensurePerson(db, name, email, counter);
    await addMember(db, personId, s26.id);
  }
  await issueFlatDues(db, s26.id);

  const dues26 = await listDues(db, s26.id);
  const unsettled = dues26.filter((row) => BURN_26_OFFSET_MEMBERS.includes(row.displayName));
  const entries = [];
  for (const row of unsettled) {
    if ((await settlementFor(db, row.dueId)).paidAgorot > 0) continue;
    entries.push({ dueId: row.dueId, amount: 1200 });
  }
  if (entries.length > 0) {
    await recordOffset(db, {
      entries,
      note: 'קיזוז מול חוב יוסף — 6,000 (יוסף קארינה יונתן ירין ועילאי)',
      paidOn: new Date('2026-07-01T00:00:00Z'),
      recordedBy: email,
    });
  }

  // The four owned רחבה deliverables.
  const existingTasks = new Set((await listTasks(db, s25.id)).map((t) => t.title));
  for (const deliverable of BURN_25_DELIVERABLES) {
    if (existingTasks.has(deliverable.title)) continue;
    await createTask(db, {
      seasonId: s25.id,
      kind: 'deliverable',
      title: deliverable.title,
      budgetAmount: deliverable.budget,
    });
    result.tasks += 1;

    if (!deliverable.owner) continue;
    const task = (await listTasks(db, s25.id))
      .find((t) => t.title === deliverable.title)!;
    const owner = await resolveName(db, deliverable.owner);
    if (!owner.personId) continue;
    const assignmentId = await assignPerson(db, task.taskId, owner.personId, email);
    await setAssignmentStatus(db, assignmentId, 'accepted');
  }

  // `מייצג`'s owner cell reads `ראנצ׳ו ונטלי` — two names in one string.
  // The system records it and stops. A lead splits it.
  await recordUnlinkedName(db, 'ראנצ׳ו ונטלי', 'import');

  result.people = counter.people;
  return result;
}
