import { describe, it, expect } from 'vitest';
import {
  topicFailureMessage, itemFailureMessage, dependencyFailureMessage,
  TITLE_REQUIRED, END_BEFORE_START, TOPIC_NAME_REQUIRED,
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
      for (const map of [topicFailureMessage, itemFailureMessage, dependencyFailureMessage]) {
        expect(map(thrown)).not.toMatch(/[A-Za-z]/);
      }
    }
  });
});
