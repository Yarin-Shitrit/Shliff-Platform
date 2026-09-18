import { describe, it, expect } from 'vitest';
import {
  parseSnoozes, serializeSnoozes, SNOOZE_LIMIT,
} from './snooze';

const NOW = new Date('2026-09-17T09:00:00Z');
const DAY = 86_400_000;

describe('parseSnoozes', () => {
  it('reads an item id and the moment it comes back', () => {
    const raw = serializeSnoozes(new Map([['name:abc', new Date('2026-09-24T09:00:00Z')]]));
    const parsed = parseSnoozes(raw, NOW);
    expect(parsed.get('name:abc')).toEqual(new Date('2026-09-24T09:00:00Z'));
  });

  it('drops an entry whose moment has passed, so a snooze expires on its own', () => {
    const raw = serializeSnoozes(new Map([['name:abc', new Date('2026-09-16T09:00:00Z')]]));
    expect(parseSnoozes(raw, NOW).size).toBe(0);
  });

  it('returns an empty map for a missing, empty or corrupt cookie', () => {
    expect(parseSnoozes(undefined, NOW).size).toBe(0);
    expect(parseSnoozes('', NOW).size).toBe(0);
    expect(parseSnoozes('not json', NOW).size).toBe(0);
    expect(parseSnoozes('{"name:abc":"not a date"}', NOW).size).toBe(0);
  });

  it('never lets one bad entry discard the good ones', () => {
    expect(parseSnoozes(
      '{"name:a":"2026-09-24T09:00:00.000Z","name:b":"nonsense"}', NOW,
    ).size).toBe(1);
  });

  it('treats a JSON array as no deferrals rather than reading its indexes', () => {
    expect(parseSnoozes('["2026-09-24T09:00:00.000Z"]', NOW).size).toBe(0);
  });
});

describe('serializeSnoozes', () => {
  // The fixture starts one day out, not zero: parseSnoozes drops an entry whose
  // moment is not in the future, so an entry set to exactly NOW is expired the
  // instant it is read and the cap would appear to be one short.
  it('keeps the soonest entries and drops the rest past the cap', () => {
    const many = new Map<string, Date>();
    for (let i = 0; i < SNOOZE_LIMIT + 10; i += 1) {
      many.set(`name:${i}`, new Date(NOW.getTime() + (i + 1) * DAY));
    }
    const parsed = parseSnoozes(serializeSnoozes(many), NOW);
    expect(parsed.size).toBe(SNOOZE_LIMIT);
    expect(parsed.has('name:0')).toBe(true);
    expect(parsed.has(`name:${SNOOZE_LIMIT + 5}`)).toBe(false);
  });

  it('round-trips through parse unchanged', () => {
    const snoozes = new Map([
      ['name:abc', new Date('2026-09-24T09:00:00Z')],
      ['sheet-season:def', new Date('2026-10-01T09:00:00Z')],
    ]);
    expect(parseSnoozes(serializeSnoozes(snoozes), NOW)).toEqual(snoozes);
  });
});
