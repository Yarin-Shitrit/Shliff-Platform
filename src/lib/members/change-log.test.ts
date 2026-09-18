import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import {
  persons, seasons, memberships, personAliases, dues, payments, tasks, taskAssignments,
} from '@/db/schema/camp';
import { toAgorot } from '@/lib/money';
import { personChangeLog } from './change-log';

let db: TestDb;

const LEAD = 'lead@shliff.test';

async function addPerson(displayName: string): Promise<string> {
  const [person] = await db.insert(persons).values({ displayName }).returning();
  return person.id;
}

async function addSeason(name: string, year: number): Promise<string> {
  const [season] = await db.insert(seasons)
    .values({ name, year, flatRate: '1200.00', plannedSize: 35 }).returning();
  return season.id;
}

beforeEach(async () => {
  db = await createTestDb();
});

describe('personChangeLog', () => {
  it('a membership entry carries the date it happened and no actor', async () => {
    const personId = await addPerson('אופק');
    const seasonId = await addSeason('ברן 26', 2026);
    const joinedAt = new Date('2026-01-05T00:00:00Z');
    await db.insert(memberships).values({ personId, seasonId, role: 'member', joinedAt });

    const [entry] = await personChangeLog(db, personId);

    expect(entry.kind).toBe('joined_season');
    expect(entry.at).toEqual(joinedAt);
    expect(entry.by).toBeNull();
    expect(entry.subject).toBe('ברן 26');
  });

  it('an exception entry carries who decided it and no timestamp', async () => {
    const personId = await addPerson('עמירם דהן');
    const seasonId = await addSeason('ברן 26', 2026);
    await db.insert(dues).values({
      personId, seasonId, amount: '0.00', kind: 'exception',
      exceptionReason: 'הוביל את ההקמה', decidedBy: LEAD,
    });

    const [entry] = await personChangeLog(db, personId);

    expect(entry.kind).toBe('exception_decided');
    expect(entry.at).toBeNull();
    expect(entry.by).toBe(LEAD);
    expect(entry.amountAgorot).toBe(toAgorot('0.00'));
  });

  it('a payment entry carries its channel as the subject and its amount', async () => {
    const personId = await addPerson('אופק');
    const seasonId = await addSeason('ברן 26', 2026);
    const [due] = await db.insert(dues)
      .values({ personId, seasonId, amount: '1200.00', kind: 'flat' }).returning();
    const paidOn = new Date('2026-02-01T00:00:00Z');
    await db.insert(payments).values({
      dueId: due.id, amount: '500.00', channel: 'ביט', paidOn, recordedBy: LEAD,
    });

    const [entry] = await personChangeLog(db, personId);

    expect(entry.kind).toBe('payment_recorded');
    expect(entry.subject).toBe('ביט');
    expect(entry.by).toBe(LEAD);
    expect(entry.amountAgorot).toBe(toAgorot('500.00'));
  });

  it('an alias linked by a lead carries the lead\'s email', async () => {
    const personId = await addPerson('נטלי');
    await db.insert(personAliases).values({
      personId, alias: 'נטלי כהן', normalized: 'נטלי כהן', source: 'manual',
      confirmedBy: LEAD, confirmedAt: new Date('2026-01-10T00:00:00Z'),
    });

    const [entry] = await personChangeLog(db, personId);

    expect(entry.kind).toBe('alias_linked');
    expect(entry.by).toBe(LEAD);
    expect(entry.subject).toBe('נטלי כהן');
  });

  it('an alias that arrived in a merge is alias_merged, not alias_linked', async () => {
    const survivorId = await addPerson('אופק');
    const sourceId = await addPerson('אופק כהן');
    await db.insert(personAliases).values({
      personId: survivorId, alias: 'אופק כהן', normalized: 'אופק כהן', source: 'manual',
      mergedFromPersonId: sourceId, confirmedBy: LEAD, confirmedAt: new Date('2026-01-15T00:00:00Z'),
    });

    const entries = await personChangeLog(db, survivorId);

    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('alias_merged');
  });

  it('an assignment carries the task title', async () => {
    const personId = await addPerson('דניאל');
    const seasonId = await addSeason('ברן 26', 2026);
    const [task] = await db.insert(tasks)
      .values({ seasonId, kind: 'build', title: 'הקמת שער' }).returning();
    await db.insert(taskAssignments).values({
      taskId: task.id, personId, assignedBy: LEAD,
    });

    const [entry] = await personChangeLog(db, personId);

    expect(entry.kind).toBe('assigned');
    expect(entry.subject).toBe('הקמת שער');
    expect(entry.by).toBe(LEAD);
  });

  it('sorts dated entries newest first, with the undated ones grouped last', async () => {
    const personId = await addPerson('אופק');
    const seasonId = await addSeason('ברן 26', 2026);
    await db.insert(memberships).values({
      personId, seasonId, role: 'member', joinedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const [due] = await db.insert(dues)
      .values({ personId, seasonId, amount: '1200.00', kind: 'flat' }).returning();
    await db.insert(payments).values({
      dueId: due.id, amount: '500.00', channel: 'ביט',
      paidOn: new Date('2026-03-01T00:00:00Z'), recordedBy: LEAD,
      createdAt: new Date('2026-03-01T00:00:00Z'),
    });
    await db.insert(dues).values({
      personId, seasonId: (await addSeason('ברן 25', 2025)), amount: '0.00', kind: 'exception',
      exceptionReason: 'פטור מתשלום', decidedBy: LEAD,
    });

    const entries = await personChangeLog(db, personId);

    expect(entries.map((e) => e.kind)).toEqual(['payment_recorded', 'joined_season', 'exception_decided']);
  });

  it('a person with nothing recorded comes back as an empty array, not a throw', async () => {
    const personId = await addPerson('חסר היסטוריה');

    const entries = await personChangeLog(db, personId);

    expect(entries).toEqual([]);
  });
});
