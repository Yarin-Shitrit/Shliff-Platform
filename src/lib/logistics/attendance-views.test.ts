import { describe, it, expect } from 'vitest';
import {
  parseAttendanceQuery, attendanceHref, eventHref, newEventHref, ATTENDANCE_PATH,
} from './attendance-views';

describe('the attendance board’s URL', () => {
  it('reads the season, the peeked day and the create verb', () => {
    expect(parseAttendanceQuery({})).toEqual({ season: '', peekEvent: null, creating: false });
    expect(parseAttendanceQuery({ season: 's1', event: 'e1' })).toEqual({ season: 's1', peekEvent: 'e1', creating: false });
    expect(parseAttendanceQuery({ act: 'event' })).toEqual({ season: '', peekEvent: null, creating: true });
  });

  it('lets a named day win over the create verb', () => {
    expect(parseAttendanceQuery({ event: 'e1', act: 'event' })).toEqual({ season: '', peekEvent: 'e1', creating: false });
  });

  it('never throws on a mangled link', () => {
    expect(parseAttendanceQuery({ season: ['s1', 's2'], event: [], act: 'nonsense' }))
      .toEqual({ season: 's1', peekEvent: null, creating: false });
  });

  it('carries the season through every link and drops the drawer unless asked', () => {
    const params = { season: 's1', event: 'e1' };
    expect(attendanceHref(params, {})).toBe(`${ATTENDANCE_PATH}?season=s1`);
    expect(eventHref(params, 'e2')).toBe(`${ATTENDANCE_PATH}?season=s1&event=e2`);
    expect(newEventHref(params)).toBe(`${ATTENDANCE_PATH}?season=s1&act=event`);
    expect(attendanceHref({}, {})).toBe(ATTENDANCE_PATH);
  });
});
