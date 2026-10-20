import { describe, it, expect } from 'vitest';
import {
  parseShiftsQuery, shiftsHref, slotHref, typeHref, newTypeHref, scheduleHref, printHref,
  dayAnchorId,
} from './shifts-views';

describe('the shifts URL', () => {
  it('reads nothing into an empty query', () => {
    expect(parseShiftsQuery({})).toEqual({
      season: '', peek: null, peekType: null, creatingType: false,
      scheduling: false, presetType: null, presetDay: null,
    });
  });

  it('opens one drawer at a time, a peeked slot winning', () => {
    expect(parseShiftsQuery({ peek: 't1', act: 'slot', type: 'x' })).toMatchObject({
      peek: 't1', scheduling: false, peekType: null, presetType: null,
    });
    expect(parseShiftsQuery({ act: 'slot', type: 'x', day: '2026-06-08' })).toMatchObject({
      scheduling: true, presetType: 'x', presetDay: '2026-06-08', peekType: null,
    });
    expect(parseShiftsQuery({ type: 'x' })).toMatchObject({ peekType: 'x', creatingType: false });
    expect(parseShiftsQuery({ act: 'type' })).toMatchObject({ creatingType: true });
    expect(parseShiftsQuery({ act: 'type', type: 'x' })).toMatchObject({ creatingType: false, peekType: 'x' });
  });

  it('takes the first of a repeated param', () => {
    expect(parseShiftsQuery({ season: ['a', 'b'] }).season).toBe('a');
  });

  it('carries the season on every link and drops any open drawer', () => {
    const params = { season: 's1', peek: 't1', act: 'slot', type: 'x', day: '2026-06-08' };
    expect(shiftsHref(params, {})).toBe('/logistics/shifts?season=s1');
    expect(slotHref(params, 't2')).toBe('/logistics/shifts?season=s1&peek=t2');
    expect(typeHref(params, 'y')).toBe('/logistics/shifts?season=s1&type=y');
    expect(newTypeHref(params)).toBe('/logistics/shifts?season=s1&act=type');
    expect(scheduleHref(params)).toBe('/logistics/shifts?season=s1&act=slot');
    expect(scheduleHref(params, { typeId: 'y', day: '2026-06-09' }))
      .toBe('/logistics/shifts?season=s1&act=slot&type=y&day=2026-06-09');
    expect(shiftsHref({}, {})).toBe('/logistics/shifts');
  });

  it('spells a day heading\'s id once, for the heading and for the strip that jumps to it', () => {
    expect(dayAnchorId(0)).toBe('shift-day-0');
    expect(dayAnchorId(5)).toBe('shift-day-5');
  });

  it('prints the same season the screen shows', () => {
    expect(printHref({ season: 's1', peek: 't1' })).toBe('/logistics/shifts/print?season=s1');
    expect(printHref({})).toBe('/logistics/shifts/print');
  });
});
