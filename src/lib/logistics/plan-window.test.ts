import { describe, it, expect } from 'vitest';
import { buildTimeline, windowStart, windowTimeline, type PlanItem, type Topic } from './plan';
import { parsePlanQuery, planHref, spanHref, windowHref, SPAN_DAYS, SPAN_LABELS, TIMELINE_SPANS } from './plan-views';

function item(over: Partial<PlanItem>): PlanItem {
  return {
    id: 'i', seasonId: 's', topicId: null, parentId: null, title: 'משימה', notes: null,
    startsOn: null, endsOn: null, status: 'open', position: 0, assignee: null, purchase: null,
    waitsFor: [], blocks: [], updatedAt: new Date('2026-01-01T00:00:00Z'), updatedBy: null,
    ...over,
  };
}

const topic = (id: string, name: string, position: number): Topic => ({
  id, seasonId: 's', name, position, notes: null, archivedAt: null,
  updatedAt: new Date('2026-01-01T00:00:00Z'), updatedBy: null,
});

const TOPICS = [topic('k', 'מטבח', 0), topic('l', 'סלון', 1)];

/* 2026-11-15 is a Sunday; the four weeks from it end on Saturday 2026-12-12. */
const FROM = '2026-11-15';

const ITEMS = [
  item({ id: 'inside', topicId: 'k', title: 'בפנים', startsOn: '2026-11-18', endsOn: '2026-11-20' }),
  item({ id: 'before', topicId: 'k', title: 'לפני', startsOn: '2026-11-01', endsOn: '2026-11-10', position: 1 }),
  item({ id: 'into', topicId: 'k', title: 'נכנסת', startsOn: '2026-11-10', endsOn: '2026-11-16', position: 2 }),
  item({ id: 'out', topicId: 'k', title: 'יוצאת', startsOn: '2026-12-11', endsOn: '2026-12-20', position: 3 }),
  item({ id: 'over', topicId: 'k', title: 'לאורך הכול', startsOn: '2026-11-01', endsOn: '2026-12-31', position: 4 }),
  item({ id: 'far', topicId: 'l', title: 'רחוק', startsOn: '2027-02-01' }),
];

const whole = buildTimeline(ITEMS, TOPICS)!;

describe('windowStart', () => {
  it('is the Sunday of the week a day is in', () => {
    expect(windowStart('2026-11-20')).toBe('2026-11-15');
    expect(windowStart('2026-11-15')).toBe('2026-11-15');
    expect(windowStart('2026-11-21')).toBe('2026-11-15');
    expect(windowStart('2026-11-22')).toBe('2026-11-22');
  });

  it('crosses a month and a year', () => {
    expect(windowStart('2027-01-01')).toBe('2026-12-27');
  });
});

describe('windowTimeline', () => {
  const view = windowTimeline(whole, FROM, 28);
  const bar = (id: string) => view.lanes.flatMap((lane) => lane.bars).find((one) => one.item.id === id);

  it('draws exactly the days asked for, from the first column', () => {
    expect(view.days).toHaveLength(28);
    expect(view.days[0]).toMatchObject({ day: '2026-11-15', index: 0, weekday: 0, dayOfMonth: 15 });
    expect(view.days[27]).toMatchObject({ day: '2026-12-12', index: 27, weekday: 6, dayOfMonth: 12 });
  });

  it('puts a bar that is wholly inside on its own days, uncut', () => {
    expect(bar('inside')).toMatchObject({ start: 3, span: 3 });
    expect(bar('inside')!.cutStart).toBeUndefined();
    expect(bar('inside')!.cutEnd).toBeUndefined();
  });

  it('leaves off an item with no day in the window', () => {
    expect(bar('before')).toBeUndefined();
    expect(bar('far')).toBeUndefined();
  });

  it('clips a bar that began earlier to the first column, and says so', () => {
    expect(bar('into')).toMatchObject({ start: 0, span: 2, cutStart: true });
    expect(bar('into')!.cutEnd).toBeUndefined();
  });

  it('clips a bar that runs on to the last column, and says so', () => {
    expect(bar('out')).toMatchObject({ start: 26, span: 2, cutEnd: true });
    expect(bar('out')!.cutStart).toBeUndefined();
  });

  it('draws an item longer than the window across all of it, cut at both ends', () => {
    expect(bar('over')).toMatchObject({ start: 0, span: 28, cutStart: true, cutEnd: true });
  });

  it('keeps every lane, bars or not, so the topics hold their places', () => {
    expect(view.lanes.map((lane) => [lane.topic?.name, lane.bars.length])).toEqual([['מטבח', 4], ['סלון', 0]]);
  });

  it('counts the bars it drew, not the plan’s', () => {
    expect(view.placed).toBe(4);
    expect(whole.placed).toBe(6);
  });

  it('does not change the plan it was cut from', () => {
    const kitchen = whole.lanes.find((lane) => lane.topic?.id === 'k')!;
    expect(kitchen.bars).toHaveLength(5);
    expect(kitchen.bars.every((one) => one.cutStart === undefined && one.cutEnd === undefined)).toBe(true);
  });

  it('draws empty weeks past the plan’s last day rather than a shorter grid', () => {
    const later = windowTimeline(whole, '2027-06-06', 28);
    expect(later.days).toHaveLength(28);
    expect(later.placed).toBe(0);
    expect(later.lanes).toHaveLength(2);
  });

  it('shows a week as seven columns', () => {
    const week = windowTimeline(whole, FROM, 7);
    expect(week.days.map((day) => day.dayOfMonth)).toEqual([15, 16, 17, 18, 19, 20, 21]);
    expect(week.lanes[0].bars.map((one) => one.item.id).sort()).toEqual(['inside', 'into', 'over']);
  });
});

describe('the span in the URL', () => {
  it('opens on four weeks around today, and on nothing else unless asked', () => {
    expect(parsePlanQuery({})).toMatchObject({ span: 'weeks4', windowAt: null });
    expect(parsePlanQuery({ span: 'week' }).span).toBe('week');
    expect(parsePlanQuery({ span: 'season' }).span).toBe('season');
    expect(parsePlanQuery({ span: 'decade' }).span).toBe('weeks4');
  });

  it('reads the day a window is paged to, and ignores one that is no day', () => {
    expect(parsePlanQuery({ at: '2026-12-13' }).windowAt).toBe('2026-12-13');
    expect(parsePlanQuery({ at: '2026-13-40' }).windowAt).toBeNull();
    expect(parsePlanQuery({ at: 'tomorrow' }).windowAt).toBeNull();
    expect(parsePlanQuery({ at: '2026-02-30' }).windowAt).toBeNull();
  });

  it('spells four weeks by its absence', () => {
    expect(spanHref({ season: 's', span: 'week' }, 'weeks4')).toBe('/logistics/plan?season=s');
    expect(spanHref({ season: 's' }, 'week')).toBe('/logistics/plan?season=s&span=week');
  });

  it('keeps the paged day between the two windows, and drops it for the season', () => {
    expect(spanHref({ season: 's', at: '2026-12-13' }, 'week')).toBe('/logistics/plan?season=s&at=2026-12-13&span=week');
    expect(spanHref({ season: 's', span: 'week', at: '2026-12-13' }, 'season')).toBe('/logistics/plan?season=s&span=season');
  });

  it('pages to a day and back to today', () => {
    expect(windowHref({ season: 's', span: 'week' }, '2026-12-13')).toBe('/logistics/plan?season=s&span=week&at=2026-12-13');
    expect(windowHref({ season: 's', span: 'week', at: '2026-12-13' }, null)).toBe('/logistics/plan?season=s&span=week');
  });

  it('survives a drawer opening and closing', () => {
    expect(planHref({ season: 's', span: 'week', at: '2026-12-13' }, { peek: 'i1' }))
      .toBe('/logistics/plan?season=s&span=week&at=2026-12-13&peek=i1');
  });

  it('has a Hebrew word and a length for every span', () => {
    for (const span of TIMELINE_SPANS) expect(SPAN_LABELS[span]).toMatch(/[א-ת]/);
    expect(SPAN_DAYS).toEqual({ week: 7, weeks4: 28, season: null });
  });
});
