import { describe, it, expect } from 'vitest';
import { HEBREW_FALLBACK } from '@/lib/errors/hebrew';
import { conditionFailureMessage } from './failure-messages';

/**
 * R9: no English reaches a Hebrew screen. Failures are mapped at the action
 * boundary, and anything unmapped becomes the Hebrew fallback and a log line
 * — never an echo of what the library threw.
 */
describe('warehouse failure messages', () => {
  it('names the item that is not there', () => {
    expect(conditionFailureMessage(new Error('unknown inventory item 7f3a')))
      .toBe('לא מצאנו את הפריט הזה במחסן');
  });

  it('explains a condition it does not recognise', () => {
    expect(conditionFailureMessage(new Error('unknown condition: broken')))
      .toBe('המצב הזה אינו אחד מארבעת המצבים האפשריים');
  });

  it('falls back to Hebrew rather than echoing an English message', () => {
    const message = conditionFailureMessage(new Error('ECONNREFUSED 127.0.0.1:5433'));
    expect(message).toBe(HEBREW_FALLBACK);
    expect(message).not.toMatch(/[A-Za-z]/);
  });

  it('never returns a Latin character, whatever it is handed', () => {
    // The container is stopped by hand from time to time, so a raw driver
    // message reaching a lead is a real path, not a hypothetical one.
    for (const thrown of [
      new Error('relation "inventory_items" does not exist'),
      new Error('Hook timed out in 10000ms'),
      new Error(''),
      'not an error at all',
      undefined,
    ]) {
      expect(conditionFailureMessage(thrown)).not.toMatch(/[A-Za-z]/);
    }
  });
});
