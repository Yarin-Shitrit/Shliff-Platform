import { describe, it, expect } from 'vitest';
import {
  topicFailureMessage, itemFailureMessage, dependencyFailureMessage, adoptFailureMessage,
  TITLE_REQUIRED, END_BEFORE_START, TOPIC_NAME_REQUIRED, PURCHASE_DONE_ON_LIST, NOTHING_CHOSEN,
} from './failure-messages';

/**
 * R9: no English reaches a Hebrew screen. Failures are mapped at the action
 * boundary, and anything unmapped becomes a Hebrew fallback — never an echo.
 */
describe('plan failure messages', () => {
  it('asks for a name in the drawer’s own words', () => {
    expect(topicFailureMessage(new Error('a topic needs a name'))).toBe(TOPIC_NAME_REQUIRED);
    expect(itemFailureMessage(new Error('a work item needs a title'))).toBe(TITLE_REQUIRED);
  });

  it('explains a date pair that reads backwards', () => {
    expect(itemFailureMessage(new Error('a work item cannot end before it starts'))).toBe(END_BEFORE_START);
  });

  it('sends a purchase’s done to the acquisitions list', () => {
    expect(itemFailureMessage(new Error('a purchase item is done when its purchase arrives'))).toBe(PURCHASE_DONE_ON_LIST);
  });

  it('tells a move that refused what did not move', () => {
    expect(adoptFailureMessage(new Error('nothing was chosen to move to the acquisitions list'))).toBe(NOTHING_CHOSEN);
    expect(adoptFailureMessage(new Error('work item abc is already in the acquisitions list'))).toMatch(/שום דבר לא הועבר/);
    expect(adoptFailureMessage(new Error('work item abc is not open'))).toMatch(/שום דבר לא הועבר/);
    expect(adoptFailureMessage(new Error('unknown work item abc'))).toMatch(/לא מצאנו/);
  });

  it('names the ring a dependency would close', () => {
    expect(dependencyFailureMessage(new Error('that dependency would make a cycle'))).toMatch(/מעגל/);
  });

  it('reads the driver’s constraint when the library’s own check lost the race', () => {
    const driver = Object.assign(new Error('duplicate key value violates unique constraint'), {
      constraint: 'work_dependencies_pair_key',
    });
    expect(dependencyFailureMessage(new Error('Failed query: insert', { cause: driver }))).toBe('הקשר הזה כבר קיים');
  });

  it('never returns a Latin character, whatever it is handed', () => {
    for (const thrown of [
      new Error('relation "work_items" does not exist'),
      new Error('ECONNREFUSED 127.0.0.1:5433'),
      new Error(''),
      'not an error at all',
      undefined,
    ]) {
      for (const map of [topicFailureMessage, itemFailureMessage, dependencyFailureMessage, adoptFailureMessage]) {
        expect(map(thrown)).not.toMatch(/[A-Za-z]/);
      }
    }
  });
});
