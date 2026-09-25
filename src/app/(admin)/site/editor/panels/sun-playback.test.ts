import { describe, it, expect } from 'vitest';
import { daySpan, momentAt, positionOf, reducedStep, scopeLength, SPEEDS, type DaySpan } from './sun-playback';

/*
 * The oracle for the spans: the almanac's sunrise and sunset at the camp pin,
 * from `shade-timeline.test.ts`'s REFERENCE (computed with the Astronomical
 * Almanac's formulae, not sun.ts): 2026-11-02 05:57:24–16:50:56 and
 * 2026-06-04 05:39:37–19:38:51. The quarter hours inside them are 06:00–16:45
 * and 05:45–19:30.
 */
const NOV2: DaySpan = { day: '2026-11-02', from: 6, to: 16.75 };
const NOV3: DaySpan = { day: '2026-11-03', from: 6, to: 16.75 };

describe('a day’s span of daylight', () => {
  it('runs over the quarter hours between sunrise and sunset — the samples the timeline takes', () => {
    expect(daySpan('2026-11-02')).toEqual(NOV2);
    expect(daySpan('2026-06-04')).toEqual({ day: '2026-06-04', from: 5.75, to: 19.5 });
  });
});

describe('where playback stands in its scope', () => {
  it('counts the minutes of daylight in the scope, and none of the night', () => {
    expect(scopeLength([NOV2])).toBe(645);
    expect(scopeLength([NOV2, NOV3])).toBe(1290);
    expect(scopeLength([])).toBe(0);
  });

  it('reads a moment as minutes from the scope’s start, and back', () => {
    expect(positionOf([NOV2, NOV3], '2026-11-02', 6)).toBe(0);
    expect(positionOf([NOV2, NOV3], '2026-11-03', 7)).toBe(705);
    expect(momentAt([NOV2, NOV3], 705)).toEqual({ day: '2026-11-03', hour: 7 });
    expect(momentAt([NOV2, NOV3], 0)).toEqual({ day: '2026-11-02', hour: 6 });
  });

  it('goes from one day’s sunset straight to the next day’s sunrise, skipping the night', () => {
    // The last quarter of the first day belongs to it; the next minute is the next morning.
    expect(momentAt([NOV2, NOV3], 645)).toEqual({ day: '2026-11-02', hour: 16.75 });
    const next = momentAt([NOV2, NOV3], 646);
    expect(next.day).toBe('2026-11-03');
    expect(next.hour).toBeCloseTo(6 + 1 / 60, 12);
  });

  it('keeps a moment inside the scope rather than past either end', () => {
    expect(positionOf([NOV2], '2026-11-02', 5)).toBe(0);
    expect(positionOf([NOV2], '2026-11-02', 18)).toBe(645);
    // A day outside the scope starts it from the beginning.
    expect(positionOf([NOV2], '2026-11-05', 12)).toBe(0);
    expect(momentAt([NOV2, NOV3], -10)).toEqual({ day: '2026-11-02', hour: 6 });
    expect(momentAt([NOV2, NOV3], 5000)).toEqual({ day: '2026-11-03', hour: 16.75 });
  });
});

describe('the speeds', () => {
  it('are three, named in Hebrew, in simulated minutes per real second', () => {
    expect(SPEEDS.map(({ label, minutesPerSecond }) => [label, minutesPerSecond])).toEqual([
      ['איטי', 10], ['רגיל', 30], ['מהיר', 90],
    ]);
  });

  it('step in whole quarter hours when motion is reduced, at least one a second', () => {
    expect(reducedStep(10)).toBe(15);
    expect(reducedStep(30)).toBe(30);
    expect(reducedStep(90)).toBe(90);
    expect(reducedStep(1)).toBe(15);
  });
});
