import { describe, it, expect } from 'vitest';
import {
  parseWorkdaysQuery, workdaysHref, weekdayOf, shortDate, daysWords, WORKDAYS_PATH,
} from './workdays-views';

describe('the ימי עבודה URL', () => {
  it('reads the season, the day and the task, and never throws on a mangled link', () => {
    expect(parseWorkdaysQuery({ season: 's', day: 'd', task: 't' })).toEqual({ season: 's', day: 'd', task: 't' });
    expect(parseWorkdaysQuery({})).toEqual({ season: '', day: null, task: null });
    expect(parseWorkdaysQuery({ season: ['a', 'b'], day: [], task: '' })).toEqual({ season: 'a', day: null, task: null });
  });

  it('carries the season on every link', () => {
    expect(workdaysHref({})).toBe(WORKDAYS_PATH);
    expect(workdaysHref({ season: 's' })).toBe(`${WORKDAYS_PATH}?season=s`);
    expect(workdaysHref({ season: 's' }, { day: 'd' })).toBe(`${WORKDAYS_PATH}?season=s&day=d`);
  });

  it('keeps the day when it opens a task, and drops the task when it closes', () => {
    const here = { season: 's', day: 'd', task: 'old' };
    expect(workdaysHref(here, { task: 't' })).toBe(`${WORKDAYS_PATH}?season=s&day=d&task=t`);
    expect(workdaysHref(here)).toBe(`${WORKDAYS_PATH}?season=s&day=d`);
    expect(workdaysHref(here, { day: null })).toBe(`${WORKDAYS_PATH}?season=s`);
  });

  it('reads the weekday from the calendar', () => {
    expect(weekdayOf('2026-03-14')).toBe('יום שבת');
    expect(shortDate('2026-03-14')).toBe('14/03/2026');
  });

  it('puts an item\'s days into words: none, the one day, or the span', () => {
    expect(daysWords(null, null)).toBe('בלי יום');
    expect(daysWords('2026-03-14', null)).toBe('יום שבת 14/03/2026');
    expect(daysWords('2026-03-14', '2026-03-14')).toBe('יום שבת 14/03/2026');
    expect(daysWords('2026-03-14', '2026-03-16')).toBe('14/03/2026–16/03/2026');
  });
});
