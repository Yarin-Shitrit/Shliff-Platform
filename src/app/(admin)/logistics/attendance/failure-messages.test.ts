import { describe, it, expect } from 'vitest';
import { HEBREW_FALLBACK } from '@/lib/errors/hebrew';
import {
  eventFailureMessage, markFailureMessage, DAY_REQUIRED, KIND_REQUIRED, NOT_ON_ROSTER, EVENT_CANCELLED,
} from './failure-messages';

/**
 * R9: no English reaches a Hebrew screen. Failures are mapped at the action
 * boundary, and anything unmapped becomes a Hebrew fallback — never an echo.
 */
describe('attendance failure messages', () => {
  it('asks for a day and a kind in the drawer’s own words', () => {
    expect(eventFailureMessage(new Error('an occasion needs a real day'))).toBe(DAY_REQUIRED);
    expect(eventFailureMessage(new Error('unknown attendance kind: party'))).toBe(KIND_REQUIRED);
  });

  it('says where a missing day or season went', () => {
    expect(eventFailureMessage(new Error('unknown occasion 1234'))).toMatch(/לא מצאנו/);
    expect(eventFailureMessage(new Error('unknown season 1234'))).toMatch(/לא מצאנו את השנה/);
  });

  it('sends a mark on a stranger to אנשים and a mark on a cancelled day to its drawer', () => {
    expect(markFailureMessage(new Error('that person is not on this season roster'))).toBe(NOT_ON_ROSTER);
    expect(markFailureMessage(new Error('unknown person abc'))).toBe(NOT_ON_ROSTER);
    expect(markFailureMessage(new Error('that occasion was cancelled'))).toBe(EVENT_CANCELLED);
    expect(markFailureMessage(new Error('unknown occasion abc'))).toMatch(/לא מצאנו/);
  });

  it('never returns a Latin character, whatever it is handed', () => {
    for (const thrown of [
      new Error('relation "attendance_events" does not exist'),
      new Error('ECONNREFUSED 127.0.0.1:5433'),
      new Error(''),
      'not an error at all',
      undefined,
    ]) {
      expect(eventFailureMessage(thrown)).not.toMatch(/[A-Za-z]/);
      expect(markFailureMessage(thrown)).not.toMatch(/[A-Za-z]/);
    }
    expect(eventFailureMessage(new Error('something new'))).toBe(HEBREW_FALLBACK);
  });
});
