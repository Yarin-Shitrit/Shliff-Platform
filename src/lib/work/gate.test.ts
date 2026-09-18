import { describe, it, expect } from 'vitest';
import { gateRelation, taskWhen, whenDate } from '@/lib/work/gate';

/** ברן 26 opens on the 22nd. Every case below is read against it. */
const GATE = new Date('2026-10-22T00:00:00+03:00');

describe('gateRelation', () => {
  it('counts the days before the gate', () => {
    expect(gateRelation(new Date('2026-10-20T09:00:00+03:00'), GATE))
      .toEqual({ kind: 'before', days: 2 });
  });

  it('counts a late-night task by the day it falls on, not by 24-hour spans', () => {
    expect(gateRelation(new Date('2026-10-21T23:40:00+03:00'), GATE))
      .toEqual({ kind: 'before', days: 1 });
  });

  it('names the gate day itself', () => {
    expect(gateRelation(new Date('2026-10-22T18:00:00+03:00'), GATE))
      .toEqual({ kind: 'gate-day' });
  });

  it('counts the days after the gate', () => {
    expect(gateRelation(new Date('2026-10-30T08:00:00+03:00'), GATE))
      .toEqual({ kind: 'after', days: 8 });
  });

  it('reports no gate when the season carries no startsOn', () => {
    expect(gateRelation(new Date('2026-10-20T09:00:00+03:00'), null))
      .toEqual({ kind: 'no-gate' });
  });

  it('counts civil days across the DST change', () => {
    // Israel ends DST on 2026-10-25. Counted as hours this is 47, not 48.
    expect(gateRelation(
      new Date('2026-10-23T12:00:00+03:00'),
      new Date('2026-10-25T12:00:00+02:00'),
    )).toEqual({ kind: 'before', days: 2 });
  });
});

describe('taskWhen', () => {
  const base = { startsAt: null, endsAt: null, dueOn: null, eventHeldOn: null };
  const starts = new Date('2026-10-23T22:00:00+03:00');
  const ends = new Date('2026-10-24T02:00:00+03:00');

  it('gives a shift its window', () => {
    expect(taskWhen({ ...base, kind: 'shift', startsAt: starts, endsAt: ends }))
      .toEqual({ kind: 'window', startsAt: starts, endsAt: ends });
  });

  it('gives a build task its deadline', () => {
    expect(taskWhen({ ...base, kind: 'build', dueOn: starts }))
      .toEqual({ kind: 'date', at: starts });
  });

  it('falls back to the event date for an event task', () => {
    expect(taskWhen({ ...base, kind: 'event_task', eventHeldOn: starts }))
      .toEqual({ kind: 'date', at: starts });
  });

  it('treats a shift missing one end as a plain date rather than a window', () => {
    expect(taskWhen({ ...base, kind: 'shift', startsAt: starts }))
      .toEqual({ kind: 'date', at: starts });
  });

  it('reports a deliverable with no date at all as undated', () => {
    expect(taskWhen({ ...base, kind: 'deliverable' })).toEqual({ kind: 'none' });
  });
});

describe('whenDate', () => {
  const starts = new Date('2026-10-23T22:00:00+03:00');
  const ends = new Date('2026-10-24T02:00:00+03:00');

  it('sorts a window by when it starts', () => {
    expect(whenDate({ kind: 'window', startsAt: starts, endsAt: ends })).toEqual(starts);
  });

  it('gives an undated task nothing to sort by', () => {
    expect(whenDate({ kind: 'none' })).toBeNull();
  });
});
