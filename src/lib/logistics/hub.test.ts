import { describe, it, expect } from 'vitest';
import type { PlanItem, Topic } from './plan';
import type { CrewRow, WorkDay } from './workdays';
import {
  attentionRows, barWords, daysAway, namesLine, shareOf, upcomingDays, type BarSegment, type HubFacts,
} from './hub';

function item(over: Partial<PlanItem>): PlanItem {
  return {
    id: 'i', seasonId: 's', topicId: null, parentId: null, title: 'משימה', notes: null,
    startsOn: null, endsOn: null, status: 'open', position: 0, assignee: null, purchase: null,
    waitsFor: [], blocks: [], updatedAt: new Date('2026-01-01T00:00:00Z'), updatedBy: null,
    ...over,
  };
}

const TOPICS: Topic[] = [];
const TODAY = '2026-11-20';
const SAT: WorkDay = { id: 'd1', label: 'יום עבודה', heldOn: '2026-11-28' };
const LATER: WorkDay = { id: 'd2', label: 'יום עבודה', heldOn: '2026-12-12' };
const PAST: WorkDay = { id: 'd0', label: 'יום עבודה', heldOn: '2026-11-14' };

const ROSTER = [
  { personId: 'p1', displayName: 'אורי' },
  { personId: 'p2', displayName: 'גל' },
  { personId: 'p3', displayName: 'טל' },
];

function crew(itemId: string, personId: string): CrewRow {
  const person = ROSTER.find((one) => one.personId === personId)!;
  return { itemId, personId, displayName: person.displayName, addedBy: 'lead@shliff.camp' };
}

describe('upcomingDays', () => {
  const items = [
    item({ id: 'a', title: 'ספסלים', startsOn: '2026-11-28' }),
    item({ id: 'b', title: 'גנרטור', startsOn: '2026-11-28' }),
    item({ id: 'c', title: 'נגמר', startsOn: '2026-11-28', status: 'done' }),
    item({ id: 'x', title: 'בוטל', startsOn: '2026-11-28', status: 'cancelled' }),
  ];

  it('drops the days behind today and reads the rest earliest first', () => {
    const days = upcomingDays([LATER, PAST, SAT], TODAY, items, TOPICS, [], ROSTER);
    expect(days.map((one) => one.day.id)).toEqual(['d1', 'd2']);
  });

  it('keeps a work day that is today', () => {
    const days = upcomingDays([SAT], '2026-11-28', items, TOPICS, [], ROSTER);
    expect(days).toHaveLength(1);
  });

  it('counts the day’s live tasks, and names the open ones nobody is on', () => {
    const [day] = upcomingDays([SAT], TODAY, items, TOPICS, [crew('a', 'p1')], ROSTER);
    expect(day.tasks).toBe(3);
    // A finished task with nobody on it is not waiting for anybody.
    expect(day.uncrewed).toEqual(['גנרטור']);
    expect(day.assigned).toBe(1);
  });

  it('counts a person on two of the day’s tasks once as assigned and once as doubled', () => {
    const [day] = upcomingDays([SAT], TODAY, items, TOPICS, [crew('a', 'p1'), crew('b', 'p1'), crew('a', 'p2')], ROSTER);
    expect(day.assigned).toBe(2);
    expect(day.doubled).toBe(1);
  });

  it('gives each line the names on it', () => {
    const [day] = upcomingDays([SAT], TODAY, items, TOPICS, [crew('a', 'p1'), crew('a', 'p2')], ROSTER);
    expect(day.lines.find((line) => line.id === 'a')?.crew).toEqual(['אורי', 'גל']);
    expect(day.lines.find((line) => line.id === 'c')?.done).toBe(true);
  });
});

describe('attentionRows', () => {
  const NOTHING: HubFacts = { warehouse: null, acquisitions: null, plan: null };

  it('writes nothing for a screen the account cannot open', () => {
    expect(attentionRows(NOTHING)).toEqual([]);
  });

  it('writes nothing where every count is zero', () => {
    expect(attentionRows({
      warehouse: { needsRepair: 0, needsTesting: 0 },
      acquisitions: { toSearch: 0, unregisteredArrivals: 0 },
      plan: { items: [item({ startsOn: '2026-12-01' })], today: TODAY, nextDay: null, nextDayWords: null },
    })).toEqual([]);
  });

  it('names the tasks past their last day', () => {
    const rows = attentionRows({
      ...NOTHING,
      plan: {
        items: [
          item({ id: 'a', title: 'בדיקת גזיות', startsOn: '2026-11-16', endsOn: '2026-11-18' }),
          item({ id: 'b', title: 'עוד לא', startsOn: '2026-11-19', endsOn: '2026-11-20' }),
          item({ id: 'c', title: 'נגמרה', startsOn: '2026-11-10', status: 'done' }),
        ],
        today: TODAY, nextDay: null, nextDayWords: null,
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'overdue', tone: 'bad', word: 'עבר התאריך', target: 'plan-list',
      headline: 'משימה פתוחה אחת אחרי היום האחרון שלה', detail: 'בדיקת גזיות',
    });
  });

  it('reports the next work day’s tasks with nobody on them, and its double bookings', () => {
    const items = [
      item({ id: 'a', title: 'ספסלים', startsOn: '2026-11-28' }),
      item({ id: 'b', title: 'גנרטור', startsOn: '2026-11-28' }),
      item({ id: 'c', title: 'מקלחות', startsOn: '2026-11-28' }),
    ];
    const [nextDay] = upcomingDays([SAT], TODAY, items, TOPICS, [crew('a', 'p1'), crew('c', 'p1')], ROSTER);
    const rows = attentionRows({
      ...NOTHING,
      plan: { items, today: TODAY, nextDay, nextDayWords: 'יום שבת 28/11/2026' },
    });
    expect(rows.map((row) => row.id)).toEqual(['uncrewed', 'doubled']);
    expect(rows[0].headline).toBe('משימה אחת של יום שבת 28/11/2026 בלי אף משובץ');
    expect(rows[0].detail).toBe('גנרטור');
    expect(rows[1].headline).toBe('מישהו אחד משובץ ליותר ממשימה אחת ביום שבת 28/11/2026');
    expect(rows.every((row) => row.target === 'workday')).toBe(true);
  });

  it('counts the open tasks with no day', () => {
    const rows = attentionRows({
      ...NOTHING,
      plan: { items: [item({ id: 'a' }), item({ id: 'b' })], today: TODAY, nextDay: null, nextDayWords: null },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'unscheduled', headline: '2 משימות פתוחות עדיין בלי יום' });
  });

  it('sends the purchases and the gear to the view that lists them', () => {
    const rows = attentionRows({
      warehouse: { needsRepair: 6, needsTesting: 1 },
      acquisitions: { toSearch: 4, unregisteredArrivals: 1 },
      plan: null,
    });
    expect(rows.map((row) => [row.id, row.target, row.word])).toEqual([
      ['to-search', 'acquisitions-to-search', 'לחפש'],
      ['unregistered', 'acquisitions-arrived', 'לא נרשם במחסן'],
      ['needs-repair', 'warehouse-attention', 'דורש תיקון'],
      ['needs-testing', 'warehouse-attention', 'דורש בדיקה'],
    ]);
    expect(rows[0].headline).toBe('4 פריטי רכש שעוד לא נמצא להם מקור');
    expect(rows[3].headline).toBe('פריט אחד במחסן צריך בדיקה לפני היציאה');
  });

  it('puts the plan before the gear', () => {
    const rows = attentionRows({
      warehouse: { needsRepair: 1, needsTesting: 0 },
      acquisitions: { toSearch: 1, unregisteredArrivals: 0 },
      plan: { items: [item({})], today: TODAY, nextDay: null, nextDayWords: null },
    });
    expect(rows.map((row) => row.screen)).toEqual(['לוח עבודה', 'רכש', 'מחסן']);
  });

  it('never writes a Latin letter into a row', () => {
    const rows = attentionRows({
      warehouse: { needsRepair: 2, needsTesting: 2 },
      acquisitions: { toSearch: 2, unregisteredArrivals: 2 },
      plan: { items: [item({}), item({ id: 'b', startsOn: '2026-11-01' })], today: TODAY, nextDay: null, nextDayWords: null },
    });
    for (const row of rows) {
      expect(`${row.word} ${row.headline} ${row.screen}`).not.toMatch(/[A-Za-z]/);
    }
  });
});

describe('the small words', () => {
  it('lists three names and counts the rest', () => {
    expect(namesLine(['א', 'ב'])).toBe('א · ב');
    expect(namesLine(['א', 'ב', 'ג', 'ד', 'ה'])).toBe('א · ב · ג · ועוד 2');
  });

  it('says how far a day is', () => {
    expect(daysAway(TODAY, '2026-11-20')).toBe('היום');
    expect(daysAway(TODAY, '2026-11-21')).toBe('מחר');
    expect(daysAway(TODAY, '2026-11-22')).toBe('בעוד יומיים');
    expect(daysAway(TODAY, '2026-11-28')).toBe('בעוד 8 ימים');
  });

  const SEGMENTS: BarSegment[] = [
    { id: 'a', label: 'תקין ומוכן', count: 3, kind: 'ok' },
    { id: 'b', label: 'דורש תיקון', count: 1, kind: 'bad' },
  ];

  it('divides the bar by the counts, and draws nothing of nothing', () => {
    expect(shareOf(SEGMENTS[0], SEGMENTS)).toBe(75);
    const empty = SEGMENTS.map((segment) => ({ ...segment, count: 0 }));
    expect(shareOf(empty[0], empty)).toBe(0);
  });

  it('reads the bar aloud with every count beside its word', () => {
    expect(barWords(SEGMENTS)).toBe('3 תקין ומוכן, 1 דורש תיקון');
  });
});
