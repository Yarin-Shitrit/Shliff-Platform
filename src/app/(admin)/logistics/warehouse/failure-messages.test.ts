import { describe, it, expect } from 'vitest';
import { HEBREW_FALLBACK } from '@/lib/errors/hebrew';
import { conditionFailureMessage, itemFailureMessage } from './failure-messages';

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

describe('the two drawers that write an item', () => {
  it('asks for a name rather than reporting that one was missing', () => {
    expect(itemFailureMessage(new Error('an inventory item must have a name')))
      .toBe('לפריט חייב להיות שם, אחרת אי אפשר לזהות אותו ברשימה');
  });

  it('says why a location is not optional', () => {
    // The refusal repeats the reason the drawer gives, because a lead who
    // hits it may have got here without reading the hint.
    expect(itemFailureMessage(new Error('an inventory item must have a location')))
      .toBe('צריך לרשום מיקום במחסן, אחרת אי אפשר יהיה למצוא את הפריט בשנה הבאה');
  });

  it('explains what a quantity may be, including zero', () => {
    expect(itemFailureMessage(new Error('an inventory quantity must be a whole number, zero or more')))
      .toBe('הכמות חייבת להיות מספר שלם, אפס או יותר');
  });

  it('explains an arriving quantity separately, because zero is wrong there', () => {
    expect(itemFailureMessage(new Error('an arriving quantity must be a whole number, one or more')))
      .toBe('הכמות שנכנסת למחסן חייבת להיות מספר שלם, אחד או יותר');
  });

  it('shares the two refusals the condition action already names', () => {
    // One item, one vocabulary: a lead who sees a different sentence for the
    // same refusal on two controls of one screen learns to distrust both.
    expect(itemFailureMessage(new Error('unknown inventory item 7f3a')))
      .toBe('לא מצאנו את הפריט הזה במחסן');
    expect(itemFailureMessage(new Error('unknown category: furniture')))
      .toBe('הקטגוריה הזו אינה אחת מחמש הקטגוריות האפשריות');
  });

  it('never returns a Latin character, whatever it is handed', () => {
    for (const thrown of [
      new Error('duplicate key value violates unique constraint'),
      new Error('ECONNREFUSED 127.0.0.1:5433'),
      new Error(''),
      undefined,
    ]) {
      expect(itemFailureMessage(thrown)).not.toMatch(/[A-Za-z]/);
    }
  });
});
