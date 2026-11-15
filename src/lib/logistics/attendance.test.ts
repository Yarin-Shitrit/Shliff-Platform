import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { persons } from '@/db/schema/camp';
import { createSeason, addMember } from '@/lib/members/roster';
import {
  listEvents, eventById, createEvent, updateEvent, setEventCancelled,
  listMarks, marksOf, setMark, attendanceRoster, buildBoard, summarizeBoard,
  listPersonalMarks, personalMarkById, addPersonalMark, removePersonalMark,
  eventLabel, weekdayOf, civilDate,
  type AttendanceEvent, type Mark, type PersonalMark, type RosterMember,
} from './attendance';

const LEAD = 'lead@shliff.camp';
const NOBODY = '00000000-0000-0000-0000-000000000000';

async function person(db: TestDb, displayName: string): Promise<string> {
  const [row] = await db.insert(persons).values({ displayName }).returning();
  return row.id;
}

describe('an occasion is a day with a kind', () => {
  let db: TestDb;
  let seasonId: string;

  beforeEach(async () => {
    db = await createTestDb();
    seasonId = (await createSeason(db, { name: 'ברן 27', year: 2027, flatRate: 1200 })).id;
  });

  it('records who made it, and comes back by id with nobody marked yet', async () => {
    const id = await createEvent(db, seasonId, { kind: 'work_day', heldOn: '2027-03-14', title: null, notes: null }, LEAD);
    const event = await eventById(db, id);
    expect(event?.kind).toBe('work_day');
    expect(event?.heldOn).toBe('2027-03-14');
    expect(event?.title).toBeNull();
    expect(event?.updatedBy).toBe(LEAD);
    expect(event?.cancelledAt).toBeNull();
    expect(event?.presentCount).toBe(0);
    expect(typeof event?.presentCount).toBe('number');
  });

  it('refuses a day that is not on the calendar, rather than rolling it over', async () => {
    await expect(createEvent(db, seasonId, { kind: 'work_day', heldOn: '2027-02-30', title: null, notes: null }, LEAD))
      .rejects.toThrow(/real day/);
    await expect(createEvent(db, seasonId, { kind: 'work_day', heldOn: '14/03/2027', title: null, notes: null }, LEAD))
      .rejects.toThrow(/real day/);
    await expect(createEvent(db, seasonId, { kind: 'work_day', heldOn: '', title: null, notes: null }, LEAD))
      .rejects.toThrow(/real day/);
  });

  it('refuses a kind it does not know', async () => {
    await expect(createEvent(db, seasonId, {
      kind: 'party' as never, heldOn: '2027-03-14', title: null, notes: null,
    }, LEAD)).rejects.toThrow(/unknown attendance kind/);
  });

  it('refuses a season that is not there', async () => {
    await expect(createEvent(db, NOBODY, { kind: 'work_day', heldOn: '2027-03-14', title: null, notes: null }, LEAD))
      .rejects.toThrow(/unknown season/);
    await expect(createEvent(db, 'not-a-uuid', { kind: 'work_day', heldOn: '2027-03-14', title: null, notes: null }, LEAD))
      .rejects.toThrow(/unknown season/);
  });

  it('trims what it stores and keeps a blank title as no title', async () => {
    const id = await createEvent(db, seasonId, { kind: 'shopping', heldOn: '2027-03-14', title: '  קניות באיקאה ', notes: '  ' }, LEAD);
    const event = await eventById(db, id);
    expect(event?.title).toBe('קניות באיקאה');
    expect(event?.notes).toBeNull();
  });

  it('returns null for an occasion that is not there, a malformed id included', async () => {
    expect(await eventById(db, NOBODY)).toBeNull();
    expect(await eventById(db, 'garbage')).toBeNull();
  });

  it('saves every field on edit and refuses to edit an occasion that is not there', async () => {
    const id = await createEvent(db, seasonId, { kind: 'work_day', heldOn: '2027-03-14', title: null, notes: null }, LEAD);
    await updateEvent(db, id, { kind: 'build_day', heldOn: '2027-03-15', title: 'בניית הבר', notes: 'הגיעו מאוחר' }, 'other@shliff.camp');

    const event = await eventById(db, id);
    expect(event?.kind).toBe('build_day');
    expect(event?.heldOn).toBe('2027-03-15');
    expect(event?.title).toBe('בניית הבר');
    expect(event?.notes).toBe('הגיעו מאוחר');
    expect(event?.updatedBy).toBe('other@shliff.camp');

    await expect(updateEvent(db, NOBODY, { kind: 'work_day', heldOn: '2027-03-14', title: null, notes: null }, LEAD))
      .rejects.toThrow(/unknown occasion/);
  });

  it('lists the season’s occasions oldest day first, and only the season’s', async () => {
    const other = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 })).id;
    await createEvent(db, seasonId, { kind: 'meeting', heldOn: '2027-05-01', title: null, notes: null }, LEAD);
    await createEvent(db, seasonId, { kind: 'work_day', heldOn: '2027-03-14', title: null, notes: null }, LEAD);
    await createEvent(db, other, { kind: 'work_day', heldOn: '2026-03-14', title: null, notes: null }, LEAD);

    const events = await listEvents(db, seasonId);
    expect(events.map((event) => event.heldOn)).toEqual(['2027-03-14', '2027-05-01']);
  });

  it('cancels and restores without losing a single mark', async () => {
    const dana = await person(db, 'דנה');
    await addMember(db, dana, seasonId);
    const id = await createEvent(db, seasonId, { kind: 'work_day', heldOn: '2027-03-14', title: null, notes: null }, LEAD);
    await setMark(db, id, dana, true, LEAD);

    await setEventCancelled(db, id, true, LEAD);
    let event = await eventById(db, id);
    expect(event?.cancelledAt).not.toBeNull();
    // The mark is still there — the count is the rows, cancelled or not.
    expect(event?.presentCount).toBe(1);
    expect(await marksOf(db, [id])).toHaveLength(1);

    await setEventCancelled(db, id, false, LEAD);
    event = await eventById(db, id);
    expect(event?.cancelledAt).toBeNull();
    expect(event?.presentCount).toBe(1);

    await expect(setEventCancelled(db, NOBODY, true, LEAD)).rejects.toThrow(/unknown occasion/);
  });
});

describe('a mark is one person at one occasion', () => {
  let db: TestDb;
  let seasonId: string;
  let eventId: string;
  let dana: string;

  beforeEach(async () => {
    db = await createTestDb();
    seasonId = (await createSeason(db, { name: 'ברן 27', year: 2027, flatRate: 1200 })).id;
    eventId = await createEvent(db, seasonId, { kind: 'work_day', heldOn: '2027-03-14', title: null, notes: null }, LEAD);
    dana = await person(db, 'דנה');
    await addMember(db, dana, seasonId);
  });

  it('marks, counts, and names who ticked the box', async () => {
    await setMark(db, eventId, dana, true, LEAD);
    const marks = await listMarks(db, seasonId);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ eventId, personId: dana, displayName: 'דנה', markedBy: LEAD });
    expect((await eventById(db, eventId))?.presentCount).toBe(1);
  });

  it('is idempotent both ways, because two leads on two phones will do exactly that', async () => {
    await setMark(db, eventId, dana, true, LEAD);
    await setMark(db, eventId, dana, true, 'other@shliff.camp');
    expect(await listMarks(db, seasonId)).toHaveLength(1);

    await setMark(db, eventId, dana, false, LEAD);
    await setMark(db, eventId, dana, false, LEAD);
    expect(await listMarks(db, seasonId)).toHaveLength(0);
  });

  it('refuses someone who is not on the season’s roster, rather than adding them', async () => {
    const stranger = await person(db, 'אורח');
    await expect(setMark(db, eventId, stranger, true, LEAD))
      .rejects.toThrow(/not on this season roster/);
    // On another season's roster is not on this one.
    const other = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 })).id;
    await addMember(db, stranger, other);
    await expect(setMark(db, eventId, stranger, true, LEAD))
      .rejects.toThrow(/not on this season roster/);
    expect(await listMarks(db, seasonId)).toHaveLength(0);
  });

  it('refuses a person who was merged away, and a malformed id', async () => {
    const twin = await person(db, 'דנה כהן');
    await addMember(db, twin, seasonId);
    await db.update(persons).set({ mergedIntoId: dana });
    // `dana` was merged into herself by that blanket update too; use a fresh one.
    const fresh = await person(db, 'רוני');
    await addMember(db, fresh, seasonId);
    await expect(setMark(db, eventId, twin, true, LEAD)).rejects.toThrow(/not on this season roster/);
    await expect(setMark(db, eventId, 'garbage', true, LEAD)).rejects.toThrow(/unknown person/);
    await setMark(db, eventId, fresh, true, LEAD);
    expect(await listMarks(db, seasonId)).toHaveLength(1);
  });

  it('refuses a cancelled occasion and one that is not there', async () => {
    await setEventCancelled(db, eventId, true, LEAD);
    await expect(setMark(db, eventId, dana, true, LEAD)).rejects.toThrow(/was cancelled/);
    await expect(setMark(db, NOBODY, dana, true, LEAD)).rejects.toThrow(/unknown occasion/);
  });

  it('lists the roster by name, without anyone merged away', async () => {
    const avi = await person(db, 'אבי');
    await addMember(db, avi, seasonId);
    const gone = await person(db, 'אבי כהן');
    await addMember(db, gone, seasonId);
    await db.update(persons).set({ mergedIntoId: avi }).where(
      // drizzle's `eq` through the schema's own column
      (await import('drizzle-orm')).eq(persons.id, gone),
    );
    const roster = await attendanceRoster(db, seasonId);
    expect(roster.map((member) => member.displayName)).toEqual(['אבי', 'דנה']);
  });

  it('marksOf answers for a set of occasions, and for none', async () => {
    await setMark(db, eventId, dana, true, LEAD);
    expect(await marksOf(db, [])).toEqual([]);
    expect((await marksOf(db, [eventId])).map((mark) => mark.displayName)).toEqual(['דנה']);
  });
});

describe('a personal mark is one person who did one thing alone', () => {
  let db: TestDb;
  let seasonId: string;
  let dana: string;

  beforeEach(async () => {
    db = await createTestDb();
    seasonId = (await createSeason(db, { name: 'ברן 27', year: 2027, flatRate: 1200 })).id;
    dana = await person(db, 'דנה');
    await addMember(db, dana, seasonId);
  });

  it('records what was done, by whom, on which day, and who wrote it down', async () => {
    const id = await addPersonalMark(db, seasonId, {
      personId: dana, doneOn: '2027-03-14', title: '  הביאה את הגנרטור ', notes: ' ',
    }, LEAD);
    const mark = await personalMarkById(db, id);
    expect(mark).toMatchObject({
      seasonId, personId: dana, displayName: 'דנה', doneOn: '2027-03-14',
      title: 'הביאה את הגנרטור', notes: null, markedBy: LEAD,
    });
  });

  it('refuses a day off the calendar, a blank title, a missing season and a stranger', async () => {
    const input = { personId: dana, doneOn: '2027-03-14', title: 'הדפסת מדבקות', notes: null };
    await expect(addPersonalMark(db, seasonId, { ...input, doneOn: '2027-02-30' }, LEAD))
      .rejects.toThrow(/real day/);
    await expect(addPersonalMark(db, seasonId, { ...input, title: '   ' }, LEAD))
      .rejects.toThrow(/needs a title/);
    await expect(addPersonalMark(db, NOBODY, input, LEAD)).rejects.toThrow(/unknown season/);

    const stranger = await person(db, 'אורח');
    await expect(addPersonalMark(db, seasonId, { ...input, personId: stranger }, LEAD))
      .rejects.toThrow(/not on this season roster/);
    await expect(addPersonalMark(db, seasonId, { ...input, personId: 'garbage' }, LEAD))
      .rejects.toThrow(/unknown person/);
    expect(await listPersonalMarks(db, seasonId)).toEqual([]);
  });

  it('lists the season’s marks oldest day first, and only the season’s', async () => {
    const other = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 })).id;
    await addMember(db, dana, other);
    await addPersonalMark(db, seasonId, { personId: dana, doneOn: '2027-05-01', title: 'ב', notes: null }, LEAD);
    await addPersonalMark(db, seasonId, { personId: dana, doneOn: '2027-03-14', title: 'א', notes: null }, LEAD);
    await addPersonalMark(db, other, { personId: dana, doneOn: '2026-03-14', title: 'ג', notes: null }, LEAD);
    expect((await listPersonalMarks(db, seasonId)).map((mark) => mark.title)).toEqual(['א', 'ב']);
  });

  it('is taken back by id, and refuses an id that is not there', async () => {
    const id = await addPersonalMark(db, seasonId, { personId: dana, doneOn: '2027-03-14', title: 'א', notes: null }, LEAD);
    await removePersonalMark(db, id);
    expect(await personalMarkById(db, id)).toBeNull();
    expect(await listPersonalMarks(db, seasonId)).toEqual([]);
    await expect(removePersonalMark(db, id)).rejects.toThrow(/unknown personal mark/);
    expect(await personalMarkById(db, 'garbage')).toBeNull();
  });
});

describe('the board is the roster against the days', () => {
  const day = (id: string, heldOn: string, cancelled = false): AttendanceEvent => ({
    id, seasonId: 's', kind: 'work_day', heldOn, title: null, notes: null,
    cancelledAt: cancelled ? new Date('2027-04-01T00:00:00Z') : null,
    createdAt: new Date('2027-03-01T00:00:00Z'), updatedAt: new Date('2027-03-01T00:00:00Z'),
    updatedBy: LEAD, presentCount: 0,
  });
  const mark = (eventId: string, personId: string, displayName: string): Mark => ({
    eventId, personId, displayName, markedBy: LEAD, createdAt: new Date('2027-03-14T18:00:00Z'),
  });
  const roster: RosterMember[] = [
    { personId: 'p-avi', displayName: 'אבי' },
    { personId: 'p-dana', displayName: 'דנה' },
    { personId: 'p-roni', displayName: 'רוני' },
  ];
  const own = (id: string, personId: string, displayName: string, title: string): PersonalMark => ({
    id, seasonId: 's', personId, displayName, doneOn: '2027-04-01', title, notes: null,
    markedBy: LEAD, createdAt: new Date('2027-04-01T18:00:00Z'),
  });

  it('gives every roster member a row, a check where a mark exists, and the count', () => {
    const board = buildBoard(
      [day('e1', '2027-03-14'), day('e2', '2027-03-21')],
      [mark('e1', 'p-dana', 'דנה'), mark('e2', 'p-dana', 'דנה'), mark('e2', 'p-avi', 'אבי')],
      roster,
    );
    expect(board.rows.map((row) => [row.displayName, row.total])).toEqual([['אבי', 1], ['דנה', 2], ['רוני', 0]]);
    expect(board.rows[1].present.has('e1')).toBe(true);
    expect(board.rows[0].present.has('e1')).toBe(false);
    expect(board.perEvent.get('e1')).toBe(0 + 1);
    expect(board.perEvent.get('e2')).toBe(2);
    expect(board.cancelled).toEqual([]);
  });

  it('keeps a cancelled day and its marks out of every figure, but not out of sight', () => {
    const board = buildBoard(
      [day('e1', '2027-03-14'), day('e2', '2027-03-21', true)],
      [mark('e1', 'p-dana', 'דנה'), mark('e2', 'p-dana', 'דנה')],
      roster,
    );
    expect(board.events.map((event) => event.id)).toEqual(['e1']);
    expect(board.cancelled.map((event) => event.id)).toEqual(['e2']);
    expect(board.rows[1].total).toBe(1);
    expect(board.perEvent.has('e2')).toBe(false);
  });

  it('keeps a marked person who has left the roster, after the roster and saying so', () => {
    const board = buildBoard(
      [day('e1', '2027-03-14')],
      [mark('e1', 'p-gone', 'יוסי'), mark('e1', 'p-dana', 'דנה')],
      roster,
    );
    const last = board.rows[board.rows.length - 1];
    expect(last).toMatchObject({ personId: 'p-gone', displayName: 'יוסי', onRoster: false, total: 1 });
    expect(board.rows.slice(0, 3).every((row) => row.onRoster)).toBe(true);
    expect(board.perEvent.get('e1')).toBe(2);
  });

  it('summarises: days, person-days, who has none, and the days by kind', () => {
    const events = [day('e1', '2027-03-14'), { ...day('e2', '2027-03-21'), kind: 'shopping' as const }, day('e3', '2027-03-28', true)];
    const board = buildBoard(events, [mark('e1', 'p-dana', 'דנה'), mark('e2', 'p-dana', 'דנה'), mark('e3', 'p-avi', 'אבי')], roster);
    const totals = summarizeBoard(board);
    expect(totals.occasions).toBe(2);
    expect(totals.marks).toBe(2);
    expect(totals.idle).toBe(2);
    expect(totals.byKind).toEqual({ work_day: 1, build_day: 0, shopping: 1, meeting: 0, other: 0 });
  });

  it('counts a personal mark in the person’s total and in the column’s foot, and never as a day', () => {
    const board = buildBoard(
      [day('e1', '2027-03-14')],
      [mark('e1', 'p-dana', 'דנה')],
      roster,
      [own('m1', 'p-dana', 'דנה', 'הביאה את הגנרטור'), own('m2', 'p-roni', 'רוני', 'הדפיס מדבקות')],
    );
    expect(board.events.map((event) => event.id)).toEqual(['e1']);
    expect(board.rows.map((row) => [row.displayName, row.personal.length, row.total]))
      .toEqual([['אבי', 0, 0], ['דנה', 1, 2], ['רוני', 1, 1]]);
    expect(board.rows[1].personal[0].title).toBe('הביאה את הגנרטור');
    expect(board.perEvent.get('e1')).toBe(1);
    expect(board.personalTotal).toBe(2);

    const totals = summarizeBoard(board);
    expect(totals.marks).toBe(3);
    expect(totals.personal).toBe(2);
    expect(totals.idle).toBe(1);
  });

  it('keeps a personal mark of someone who left the roster, as a row that says so', () => {
    const board = buildBoard([], [], roster, [own('m1', 'p-gone', 'יוסי', 'תיקן את המקרר')]);
    const last = board.rows[board.rows.length - 1];
    expect(last).toMatchObject({ personId: 'p-gone', displayName: 'יוסי', onRoster: false, total: 1 });
    expect(summarizeBoard(board).idle).toBe(3);
  });

  it('does not count someone off the roster as idle, because idle is a roster word', () => {
    const board = buildBoard([day('e1', '2027-03-14')], [mark('e1', 'p-gone', 'יוסי')], roster);
    expect(summarizeBoard(board).idle).toBe(3);
  });

  it('is empty on a fresh season, so the page draws its invitation', () => {
    const board = buildBoard([], [], roster);
    expect(board.events).toEqual([]);
    expect(board.rows.every((row) => row.total === 0)).toBe(true);
    expect(summarizeBoard(board)).toEqual({
      occasions: 0, marks: 0, personal: 0, idle: 3,
      byKind: { work_day: 0, build_day: 0, shopping: 0, meeting: 0, other: 0 },
    });
  });
});

describe('what a day is called', () => {
  it('reads the title when there is one and the kind when there is not', () => {
    expect(eventLabel({ kind: 'shopping', title: 'קניות באיקאה' })).toBe('קניות באיקאה');
    expect(eventLabel({ kind: 'build_day', title: null })).toBe('יום הקמות');
  });

  it('reads the weekday off the calendar', () => {
    // 14 March 2027 is a Sunday.
    expect(weekdayOf('2027-03-14')).toBe('יום ראשון');
    expect(weekdayOf('2027-03-20')).toBe('יום שבת');
  });

  it('makes an instant that reads back as the same day in the camp', () => {
    expect(civilDate('2027-03-14').toISOString()).toBe('2027-03-14T00:00:00.000Z');
  });
});
