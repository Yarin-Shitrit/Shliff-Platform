import { describe, it, expect } from 'vitest';
import {
  parseAttendanceQuery, attendanceHref, eventHref, newEventHref, personHref, newPersonalHref,
  ATTENDANCE_PATH,
} from './attendance-views';

const NONE = { peekEvent: null, creating: false, peekPerson: null, addingPersonal: false };

describe('the attendance board’s URL', () => {
  it('reads the season, the peeked day and the create verb', () => {
    expect(parseAttendanceQuery({})).toEqual({ season: '', ...NONE });
    expect(parseAttendanceQuery({ season: 's1', event: 'e1' })).toEqual({ season: 's1', ...NONE, peekEvent: 'e1' });
    expect(parseAttendanceQuery({ act: 'event' })).toEqual({ season: '', ...NONE, creating: true });
  });

  it('reads the peeked person and the personal-mark verb', () => {
    expect(parseAttendanceQuery({ person: 'p1' })).toEqual({ season: '', ...NONE, peekPerson: 'p1' });
    expect(parseAttendanceQuery({ act: 'personal' })).toEqual({ season: '', ...NONE, addingPersonal: true });
  });

  it('lets a named record win over a create verb, and a day over a person', () => {
    expect(parseAttendanceQuery({ event: 'e1', act: 'event' })).toEqual({ season: '', ...NONE, peekEvent: 'e1' });
    expect(parseAttendanceQuery({ person: 'p1', act: 'personal' })).toEqual({ season: '', ...NONE, peekPerson: 'p1' });
    expect(parseAttendanceQuery({ event: 'e1', person: 'p1' })).toEqual({ season: '', ...NONE, peekEvent: 'e1' });
  });

  it('never throws on a mangled link', () => {
    expect(parseAttendanceQuery({ season: ['s1', 's2'], event: [], person: [], act: 'nonsense' }))
      .toEqual({ season: 's1', ...NONE });
  });

  it('carries the season through every link and drops the drawer unless asked', () => {
    const params = { season: 's1', event: 'e1' };
    expect(attendanceHref(params, {})).toBe(`${ATTENDANCE_PATH}?season=s1`);
    expect(eventHref(params, 'e2')).toBe(`${ATTENDANCE_PATH}?season=s1&event=e2`);
    expect(newEventHref(params)).toBe(`${ATTENDANCE_PATH}?season=s1&act=event`);
    expect(personHref(params, 'p1')).toBe(`${ATTENDANCE_PATH}?season=s1&person=p1`);
    expect(newPersonalHref({ season: 's1', person: 'p1' })).toBe(`${ATTENDANCE_PATH}?season=s1&act=personal`);
    expect(attendanceHref({}, {})).toBe(ATTENDANCE_PATH);
  });
});
