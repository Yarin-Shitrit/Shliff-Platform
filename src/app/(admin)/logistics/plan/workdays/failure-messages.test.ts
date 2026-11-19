import { describe, it, expect } from 'vitest';
import { crewFailureMessage, ITEM_CANCELLED, NOT_ON_ROSTER } from './failure-messages';

/** R9: no English reaches a Hebrew screen. */
describe('crew failure messages', () => {
  it('says what to do about each refusal the library makes', () => {
    expect(crewFailureMessage(new Error('that work item was cancelled'))).toBe(ITEM_CANCELLED);
    expect(crewFailureMessage(new Error('that person is not on this season roster'))).toBe(NOT_ON_ROSTER);
    expect(crewFailureMessage(new Error('unknown person nope'))).toBe(NOT_ON_ROSTER);
    expect(crewFailureMessage(new Error('unknown work item abc'))).toMatch(/לא מצאנו/);
  });

  it('never returns a Latin character, whatever it is handed', () => {
    for (const thrown of [
      new Error('relation "work_item_people" does not exist'),
      new Error('ECONNREFUSED 127.0.0.1:5433'),
      new Error(''),
      'not an error at all',
      undefined,
    ]) {
      expect(crewFailureMessage(thrown)).not.toMatch(/[A-Za-z]/);
    }
  });
});
