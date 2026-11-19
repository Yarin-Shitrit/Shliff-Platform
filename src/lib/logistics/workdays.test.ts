import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { persons } from '@/db/schema/camp';
import { createSeason, addMember } from '@/lib/members/roster';
import { createItem, createTopic, listPlan, listTopics, planRoster, setItemStatus } from './plan';
import { buildDay, listCrew, pickDay, setCrewMember, tasksOn, type WorkDay } from './workdays';

const LEAD = 'lead@shliff.camp';
const NOBODY = '00000000-0000-0000-0000-000000000000';

async function person(db: TestDb, displayName: string): Promise<string> {
  const [row] = await db.insert(persons).values({ displayName }).returning();
  return row.id;
}

function item(title: string, startsOn: string | null, endsOn: string | null = null, extra: { topicId?: string; parentId?: string } = {}) {
  return {
    title, notes: null, topicId: extra.topicId ?? null, parentId: extra.parentId ?? null,
    startsOn, endsOn, assigneePersonId: null,
  };
}

describe('the crew of a task', () => {
  let db: TestDb;
  let seasonId: string;
  let dana: string;
  let omer: string;
  let benches: string;

  beforeEach(async () => {
    db = await createTestDb();
    seasonId = (await createSeason(db, { name: 'ברן 27', year: 2027, flatRate: 1200 })).id;
    dana = await person(db, 'דנה');
    omer = await person(db, 'עומר');
    await addMember(db, dana, seasonId);
    await addMember(db, omer, seasonId);
    benches = await createItem(db, seasonId, item('בניית ספסלים', '2027-03-14'), LEAD);
  });

  it('puts a person on a task, by name, and remembers who put them there', async () => {
    await setCrewMember(db, benches, dana, true, LEAD);
    const crew = await listCrew(db, seasonId);
    expect(crew).toEqual([{ itemId: benches, personId: dana, displayName: 'דנה', addedBy: LEAD }]);
  });

  it('is idempotent both ways: a second tick and a second clear change nothing', async () => {
    await setCrewMember(db, benches, dana, true, LEAD);
    await setCrewMember(db, benches, dana, true, 'other@shliff.camp');
    expect(await listCrew(db, seasonId)).toHaveLength(1);
    expect((await listCrew(db, seasonId))[0].addedBy).toBe(LEAD);
    await setCrewMember(db, benches, dana, false, LEAD);
    await setCrewMember(db, benches, dana, false, LEAD);
    expect(await listCrew(db, seasonId)).toEqual([]);
  });

  it('refuses a person who is not on the season roster, and one merged away', async () => {
    const stranger = await person(db, 'זר');
    await expect(setCrewMember(db, benches, stranger, true, LEAD)).rejects.toThrow(/not on this season roster/);
    await db.update(persons).set({ mergedIntoId: omer }).where(eq(persons.id, dana));
    await expect(setCrewMember(db, benches, dana, true, LEAD)).rejects.toThrow(/not on this season roster/);
    expect(await listCrew(db, seasonId)).toEqual([]);
  });

  it('refuses a task that is not there, and ids that are not ids', async () => {
    await expect(setCrewMember(db, NOBODY, dana, true, LEAD)).rejects.toThrow(/unknown work item/);
    await expect(setCrewMember(db, 'nope', dana, true, LEAD)).rejects.toThrow(/unknown work item/);
    await expect(setCrewMember(db, benches, 'nope', true, LEAD)).rejects.toThrow(/unknown person/);
  });

  it('refuses to add to a cancelled task, and still lets its crew be taken off', async () => {
    await setCrewMember(db, benches, dana, true, LEAD);
    await setItemStatus(db, benches, 'cancelled', LEAD);
    await expect(setCrewMember(db, benches, omer, true, LEAD)).rejects.toThrow(/was cancelled/);
    await setCrewMember(db, benches, dana, false, LEAD);
    expect(await listCrew(db, seasonId)).toEqual([]);
  });

  it('keeps one season’s crew out of another’s', async () => {
    const other = (await createSeason(db, { name: 'ברן 28', year: 2028, flatRate: 1200 })).id;
    await setCrewMember(db, benches, dana, true, LEAD);
    expect(await listCrew(db, other)).toEqual([]);
  });

  it('builds a day: its tasks with their crews, who is free, and who is on two', async () => {
    const topicId = await createTopic(db, seasonId, { name: 'סלון', notes: null }, LEAD);
    const lounge = await createItem(db, seasonId, item('להכין סלון', '2027-03-10', '2027-03-20', { topicId }), LEAD);
    const paint = await createItem(db, seasonId, item('לצבוע', '2027-03-14', null, { parentId: lounge }), LEAD);
    await createItem(db, seasonId, item('יום אחר', '2027-04-01'), LEAD);
    await createItem(db, seasonId, item('בלי יום', null), LEAD);
    const noa = await person(db, 'נועה');
    await addMember(db, noa, seasonId);

    await setCrewMember(db, benches, dana, true, LEAD);
    await setCrewMember(db, paint, dana, true, LEAD);
    await setCrewMember(db, paint, omer, true, LEAD);

    const view = buildDay(
      '2027-03-14',
      await listPlan(db, seasonId), await listTopics(db, seasonId),
      await listCrew(db, seasonId), await planRoster(db, seasonId),
    );

    expect(view.tasks.map((task) => task.item.title).sort()).toEqual(['בניית ספסלים', 'להכין סלון', 'לצבוע'].sort());
    const painting = view.tasks.find((task) => task.item.id === paint)!;
    expect(painting.topicName).toBe('סלון');
    expect(painting.parentTitle).toBe('להכין סלון');
    expect(painting.crew.map((one) => one.displayName)).toEqual(['דנה', 'עומר']);
    expect(painting.crew[0].alsoOn).toEqual(['בניית ספסלים']);
    expect(painting.crew[1].alsoOn).toEqual([]);
    expect(painting.crew.every((one) => one.onRoster)).toBe(true);

    expect(view.assigned).toBe(2);
    expect(view.free.map((one) => one.displayName)).toEqual(['נועה']);
    expect(view.doubled).toHaveLength(1);
    expect(view.doubled[0].displayName).toBe('דנה');
    expect([...view.doubled[0].titles].sort()).toEqual(['בניית ספסלים', 'לצבוע'].sort());
  });

  it('still names someone on a task who has left the roster', async () => {
    await setCrewMember(db, benches, dana, true, LEAD);
    const view = buildDay(
      '2027-03-14', await listPlan(db, seasonId), [], await listCrew(db, seasonId),
      [{ personId: omer, displayName: 'עומר' }],
    );
    expect(view.tasks[0].crew).toEqual([{ personId: dana, displayName: 'דנה', onRoster: false, alsoOn: [] }]);
    expect(view.free.map((one) => one.displayName)).toEqual(['עומר']);
  });
});

describe('which tasks a day holds', () => {
  const rows = [
    { id: 'a', status: 'open' as const, startsOn: '2027-03-14', endsOn: null },
    { id: 'b', status: 'done' as const, startsOn: '2027-03-10', endsOn: '2027-03-14' },
    { id: 'c', status: 'cancelled' as const, startsOn: '2027-03-14', endsOn: null },
    { id: 'd', status: 'open' as const, startsOn: null, endsOn: null },
    { id: 'e', status: 'open' as const, startsOn: '2027-03-15', endsOn: '2027-03-16' },
  ];

  it('takes the one-day item on the day, the span around it, and a finished one; not a cancelled, undated or later one', () => {
    expect(tasksOn(rows, '2027-03-14').map((row) => row.id)).toEqual(['a', 'b']);
    expect(tasksOn(rows, '2027-03-16').map((row) => row.id)).toEqual(['e']);
    expect(tasksOn(rows, '2027-03-09')).toEqual([]);
  });
});

describe('which day the screen opens on', () => {
  const days: WorkDay[] = [
    { id: 'late', label: 'יום עבודה', heldOn: '2027-04-04' },
    { id: 'early', label: 'יום עבודה', heldOn: '2027-03-14' },
    { id: 'mid', label: 'בניית הבר', heldOn: '2027-03-21' },
  ];

  it('opens on the day the URL names', () => {
    expect(pickDay(days, 'late', '2027-01-01')?.id).toBe('late');
  });

  it('otherwise on the next work day from today, today included', () => {
    expect(pickDay(days, null, '2027-03-15')?.id).toBe('mid');
    expect(pickDay(days, null, '2027-03-21')?.id).toBe('mid');
    expect(pickDay(days, 'gone', '2027-01-01')?.id).toBe('early');
  });

  it('on the last one when every day is behind, and on nothing when there are none', () => {
    expect(pickDay(days, null, '2027-12-01')?.id).toBe('late');
    expect(pickDay([], null, '2027-03-15')).toBeNull();
  });
});
