import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues, setException } from '@/lib/fees/dues';
import { recordPayment } from '@/lib/fees/payments';
import { createTask } from '@/lib/work/tasks';
import { assignPerson } from '@/lib/work/coverage';
import {
  dues, persons, personAliases, memberships, payments, taskAssignments,
} from '@/db/schema/camp';
import { eq, and } from 'drizzle-orm';
import { toAgorot } from '@/lib/money';
import { listPeopleForSeason } from './people-list';

const LEAD = 'lead@shliff.camp';

let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });

async function dueIdFor(personId: string, seasonId: string): Promise<string> {
  const [row] = await db.select().from(dues)
    .where(and(eq(dues.personId, personId), eq(dues.seasonId, seasonId)));
  return row.id;
}

describe('listPeopleForSeason', () => {
  it('carries the season chips for every year a person took part in', async () => {
    const y25 = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    const y26 = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const ofek = await createPerson(db, 'אופק כהן', LEAD);
    await addMember(db, ofek, y25.id, 'member');
    await addMember(db, ofek, y26.id, 'lead');

    const [row] = await listPeopleForSeason(db, y26.id);

    expect(row.seasons.map((s) => s.name)).toEqual(['ברן 25', 'ברן 26']);
    expect(row.seasons.map((s) => s.role)).toEqual(['member', 'lead']);
    expect(row.role).toBe('lead');
    expect(row.onScopeSeason).toBe(true);
  });

  it('reads a due settled entirely by קיזוז as שולם בקיזוז, not as plain paid', async () => {
    const y26 = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const yosef = await createPerson(db, 'יוסף', LEAD);
    await addMember(db, yosef, y26.id);
    await issueFlatDues(db, y26.id);
    await recordPayment(db, {
      dueId: await dueIdFor(yosef, y26.id), amount: 1200, channel: 'קיזוז',
      paidOn: new Date('2026-07-02'), note: 'מול החוב על מקדמת הגנרטור', recordedBy: LEAD,
    });

    const [row] = await listPeopleForSeason(db, y26.id);

    expect(row.dues?.state).toBe('offset');
    expect(row.dues?.outstandingAgorot).toBe(0);
    expect(row.outstandingAgorot).toBe(0);
  });

  it('separates a part payment from no payment at all', async () => {
    const y26 = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const half = await createPerson(db, 'עומר ביטון', LEAD);
    const none = await createPerson(db, 'תמר גולן', LEAD);
    await addMember(db, half, y26.id);
    await addMember(db, none, y26.id);
    await issueFlatDues(db, y26.id);
    await recordPayment(db, {
      dueId: await dueIdFor(half, y26.id), amount: 500, channel: 'ביט',
      paidOn: new Date('2026-08-28'), recordedBy: LEAD,
    });

    const rows = await listPeopleForSeason(db, y26.id);
    const byName = new Map(rows.map((r) => [r.displayName, r]));

    expect(byName.get('עומר ביטון')?.dues?.state).toBe('partial');
    expect(byName.get('עומר ביטון')?.outstandingAgorot).toBe(70000);
    expect(byName.get('תמר גולן')?.dues?.state).toBe('unpaid');
    expect(byName.get('תמר גולן')?.outstandingAgorot).toBe(120000);
  });

  it('sums outstandingAgorot across every season a person owes on, not the scope one', async () => {
    // A debt from ברן 25 must still show on someone who rolls onto ברן 26's
    // roster — a roster that scoped the number to the season being viewed is
    // exactly how that debt gets forgotten. Two seasons, two unpaid dues, one
    // person: the total may not depend on which season (or none) is the scope.
    const y25 = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    const y26 = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const owesBoth = await createPerson(db, 'עומר ביטון', LEAD);
    await addMember(db, owesBoth, y25.id);
    await addMember(db, owesBoth, y26.id);
    await issueFlatDues(db, y25.id);
    await issueFlatDues(db, y26.id);

    const totalAgorot = toAgorot(y25.flatRate) + toAgorot(y26.flatRate);

    const [scopedToB] = await listPeopleForSeason(db, y26.id);
    expect(scopedToB.outstandingAgorot).toBe(totalAgorot);

    const [scopedToA] = await listPeopleForSeason(db, y25.id);
    expect(scopedToA.outstandingAgorot).toBe(totalAgorot);

    const [campWide] = await listPeopleForSeason(db, null);
    expect(campWide.outstandingAgorot).toBe(totalAgorot);
  });

  it('calls a zero-amount exception פטור and an un-issued due אין חיוב, never both nothing', async () => {
    const y26 = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const exempt = await createPerson(db, 'שירה אברהם', LEAD);
    const unbilled = await createPerson(db, 'ליאור קפלן', LEAD);
    await addMember(db, exempt, y26.id, 'lead');
    await addMember(db, unbilled, y26.id);
    await issueFlatDues(db, y26.id);
    await setException(db, {
      personId: exempt, seasonId: y26.id, amount: 0,
      reason: 'הובילה את ההקמה', decidedBy: LEAD,
    });
    await db.delete(dues).where(and(
      eq(dues.personId, unbilled), eq(dues.seasonId, y26.id),
    ));

    const rows = await listPeopleForSeason(db, y26.id);
    const byName = new Map(rows.map((r) => [r.displayName, r]));

    expect(byName.get('שירה אברהם')?.dues?.state).toBe('exempt');
    expect(byName.get('שירה אברהם')?.dues?.exceptionReason).toBe('הובילה את ההקמה');
    expect(byName.get('ליאור קפלן')?.dues).toBeNull();
  });
});

describe('listPeopleForSeason — the facts the list columns need', () => {
  it('counts only live assignments on scope-season tasks', async () => {
    const y25 = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    const y26 = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const roni = await createPerson(db, 'רוני אדלר', LEAD);
    await addMember(db, roni, y25.id);
    await addMember(db, roni, y26.id);

    const thisYear = await createTask(db, {
      seasonId: y26.id, kind: 'build', title: 'הקמת הצל', peopleNeeded: 2,
    });
    const lastYear = await createTask(db, {
      seasonId: y25.id, kind: 'build', title: 'הקמה 25', peopleNeeded: 1,
    });
    const dropped = await createTask(db, {
      seasonId: y26.id, kind: 'shift', title: 'משמרת בר', peopleNeeded: 1,
      startsAt: new Date('2026-08-01T20:00:00Z'), endsAt: new Date('2026-08-02T00:00:00Z'),
    });
    await assignPerson(db, thisYear, roni, LEAD, 'accepted');
    await assignPerson(db, lastYear, roni, LEAD, 'accepted');
    const droppedId = await assignPerson(db, dropped, roni, LEAD, 'accepted');
    const { setAssignmentStatus } = await import('@/lib/work/coverage');
    await setAssignmentStatus(db, droppedId, 'dropped');

    const [row] = await listPeopleForSeason(db, y26.id);
    expect(row.taskCount).toBe(1);
  });

  it('marks someone new this season, and someone who did not come back', async () => {
    const y25 = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    const y26 = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const fresh = await createPerson(db, 'תמר גולן', LEAD);
    const gone = await createPerson(db, 'דניאל שפירא', LEAD);
    const both = await createPerson(db, 'נועה לוי', LEAD);
    await addMember(db, fresh, y26.id);
    await addMember(db, gone, y25.id);
    await addMember(db, both, y25.id);
    await addMember(db, both, y26.id);

    const byName = new Map(
      (await listPeopleForSeason(db, y26.id)).map((r) => [r.displayName, r]),
    );

    expect(byName.get('תמר גולן')?.newThisSeason).toBe(true);
    expect(byName.get('תמר גולן')?.lapsed).toBe(false);
    expect(byName.get('דניאל שפירא')?.lapsed).toBe(true);
    expect(byName.get('דניאל שפירא')?.newThisSeason).toBe(false);
    expect(byName.get('נועה לוי')?.newThisSeason).toBe(false);
    expect(byName.get('נועה לוי')?.lapsed).toBe(false);
  });

  it('lists every alias but the display name, so the name cell can say "גם:"', async () => {
    const roni = await createPerson(db, 'רוני אדלר', LEAD);
    const { recordUnlinkedName } = await import('@/lib/members/identity');
    const { linkAlias } = await import('@/lib/members/link');
    await linkAlias(db, await recordUnlinkedName(db, 'Roni A.', 'import'), roni, LEAD);
    await linkAlias(db, await recordUnlinkedName(db, 'רוני', 'import'), roni, LEAD);

    const [row] = await listPeopleForSeason(db, null);
    expect(row.aliases).toEqual(['Roni A.', 'רוני']);
  });

  it('includes a person who is on no season at all when there is no scope season', async () => {
    const y26 = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const onRoster = await createPerson(db, 'אופק כהן', LEAD);
    await addMember(db, onRoster, y26.id);
    await createPerson(db, 'עמירם דהן', LEAD);

    const names = (await listPeopleForSeason(db, null)).map((r) => r.displayName);
    expect(names).toContain('אופק כהן');
    expect(names).toContain('עמירם דהן');

    const scoped = await listPeopleForSeason(db, y26.id);
    expect(scoped.map((r) => r.displayName)).toContain('עמירם דהן');
    expect(scoped.find((r) => r.displayName === 'עמירם דהן')?.onScopeSeason).toBe(false);
    expect(scoped.find((r) => r.displayName === 'עמירם דהן')?.dues).toBeNull();
  });

  it('hides a person who was merged away, the way listPeople does', async () => {
    const survivor = await createPerson(db, 'אופק כהן', LEAD);
    const absorbed = await createPerson(db, 'אופק', LEAD);
    const { mergePersons } = await import('@/lib/members/link');
    expect((await mergePersons(db, absorbed, survivor, LEAD)).ok).toBe(true);

    const rows = await listPeopleForSeason(db, null);
    expect(rows).toHaveLength(1);
    expect(rows[0].displayName).toBe('אופק כהן');
    expect(rows[0].aliases).toContain('אופק');
  });

  it('takes lastActivityAt from whichever of several stamps is newest', async () => {
    // A fixture where every candidate stamp agrees, or where only one exists,
    // passes no matter which source (or none) the implementation actually
    // reads — that is the exact test this replaces. Here all five candidates
    // (persons.createdAt, the alias confirmedAt, the membership joinedAt, a
    // payment's createdAt, and a task assignment's createdAt) are forced to
    // distinct, ordered moments, and only the true maximum — the assignment,
    // deliberately not the last one created — may satisfy the assertion.
    const y26 = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const person = await createPerson(db, 'מיכל רוזן', LEAD);
    await addMember(db, person, y26.id);
    await issueFlatDues(db, y26.id);
    const paymentId = await recordPayment(db, {
      dueId: await dueIdFor(person, y26.id), amount: 1200, channel: 'העברה',
      paidOn: new Date('2026-09-12'), recordedBy: LEAD,
    });
    const task = await createTask(db, {
      seasonId: y26.id, kind: 'build', title: 'הקמת הצל', peopleNeeded: 1,
    });
    const assignmentId = await assignPerson(db, task, person, LEAD, 'accepted');

    await db.update(persons).set({ createdAt: new Date('2020-01-01') })
      .where(eq(persons.id, person));
    await db.update(personAliases).set({ confirmedAt: new Date('2021-01-01') })
      .where(eq(personAliases.personId, person));
    await db.update(memberships).set({ joinedAt: new Date('2022-01-01') })
      .where(and(eq(memberships.personId, person), eq(memberships.seasonId, y26.id)));
    await db.update(payments).set({ createdAt: new Date('2023-01-01') })
      .where(eq(payments.id, paymentId));
    const newestStamp = new Date('2024-06-01');
    await db.update(taskAssignments).set({ createdAt: newestStamp })
      .where(eq(taskAssignments.id, assignmentId));

    const [row] = await listPeopleForSeason(db, y26.id);
    expect(row.lastActivityAt.getTime()).toBe(newestStamp.getTime());
  });

  it('issues the same number of statements for forty people as for two', async () => {
    const y26 = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });

    function counting(): { db: TestDb; count: () => number } {
      let n = 0;
      const proxy = new Proxy(db, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (prop === 'select' && typeof value === 'function') {
            return (...args: unknown[]) => { n += 1; return value.apply(target, args); };
          }
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }) as TestDb;
      return { db: proxy, count: () => n };
    }

    for (let i = 0; i < 2; i += 1) {
      await addMember(db, await createPerson(db, `אדם ${i}`, LEAD), y26.id);
    }
    await issueFlatDues(db, y26.id);
    const small = counting();
    await listPeopleForSeason(small.db, y26.id);

    for (let i = 2; i < 40; i += 1) {
      await addMember(db, await createPerson(db, `אדם ${i}`, LEAD), y26.id);
    }
    await issueFlatDues(db, y26.id);
    const big = counting();
    const rows = await listPeopleForSeason(big.db, y26.id);

    expect(rows).toHaveLength(40);
    expect(big.count()).toBe(small.count());
    expect(big.count()).toBeLessThanOrEqual(7);
  });
});

describe('listPeopleForSeason against seasonFeeSummary', () => {
  /**
   * The list's totals row is summed from the rows it is holding, so that a
   * filtered footer agrees with the rows above it. `seasonFeeSummary` sums the
   * same facts independently, for `/fees` and for בית. Two derivations of one
   * number drift unless something holds them together; this is that something.
   */
  it('agrees with seasonFeeSummary on the unfiltered season roster', async () => {
    const { seasonFeeSummary } = await import('@/lib/fees/summary');
    const y26 = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const paid = await createPerson(db, 'נועה לוי', LEAD);
    const part = await createPerson(db, 'עומר ביטון', LEAD);
    const owing = await createPerson(db, 'תמר גולן', LEAD);
    const unbilled = await createPerson(db, 'ליאור קפלן', LEAD);
    for (const id of [paid, part, owing, unbilled]) await addMember(db, id, y26.id);
    await issueFlatDues(db, y26.id);
    await db.delete(dues).where(and(
      eq(dues.personId, unbilled), eq(dues.seasonId, y26.id),
    ));
    await recordPayment(db, {
      dueId: await dueIdFor(paid, y26.id), amount: 1200, channel: 'העברה',
      paidOn: new Date('2026-08-21'), recordedBy: LEAD,
    });
    await recordPayment(db, {
      dueId: await dueIdFor(part, y26.id), amount: 500, channel: 'ביט',
      paidOn: new Date('2026-08-28'), recordedBy: LEAD,
    });

    const rows = (await listPeopleForSeason(db, y26.id)).filter((r) => r.onScopeSeason);
    const summary = await seasonFeeSummary(db, y26.id);

    expect(rows).toHaveLength(summary.memberCount);
    expect(rows.filter((r) => r.dues !== null && !['paid', 'offset', 'exempt'].includes(r.dues.state)))
      .toHaveLength(summary.unpaidCount);
    expect(rows.filter((r) => r.dues === null)).toHaveLength(summary.missingDues.length);
    expect(rows.reduce((total, r) => total + r.outstandingAgorot, 0))
      .toBe(summary.outstandingAgorot);
  });
});
