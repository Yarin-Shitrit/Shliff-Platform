import { describe, it, expect } from 'vitest';
import { HEBREW_FALLBACK } from '@/lib/errors/hebrew';
import {
  acquisitionFailureMessage, arrivalFailureMessage,
  REQUIRED_LENDER, REQUIRED_LOCATION,
} from './failure-messages';

describe('what the acquisitions screen says when a write is refused', () => {
  it('names the row that is not there', () => {
    expect(acquisitionFailureMessage(new Error('unknown acquisition 7f3a')))
      .toBe('לא מצאנו את הפריט הזה ברשימת הרכש');
  });

  it('explains the lender rule in terms of what goes wrong', () => {
    // Not "the field is required": the reason is that there is nobody to give
    // it back to at the end of the burn, and that is what the sentence says.
    expect(acquisitionFailureMessage(new Error('a borrowed acquisition must name the lender')))
      .toBe(REQUIRED_LENDER);
  });

  it('covers the three enums a URL or a stale tab can get wrong', () => {
    expect(acquisitionFailureMessage(new Error('unknown category: furniture')))
      .toMatch(/קטגוריה/);
    expect(acquisitionFailureMessage(new Error('unknown source: barter')))
      .toMatch(/דרך ההשגה/);
    expect(acquisitionFailureMessage(new Error('unknown status: lost')))
      .toMatch(/סטטוס/);
  });

  it('never returns a Latin character, whatever it is handed', () => {
    for (const thrown of [
      new Error('ECONNREFUSED 127.0.0.1:5433'),
      new Error('relation "acquisition_items" does not exist'),
      new Error(''),
      undefined,
    ]) {
      expect(acquisitionFailureMessage(thrown)).not.toMatch(/[A-Za-z]/);
    }
    expect(acquisitionFailureMessage(new Error('boom'))).toBe(HEBREW_FALLBACK);
  });
});

describe('what the arrival drawer says', () => {
  it('speaks the warehouse rules as well as its own', () => {
    // The arrival writes an inventory row, so it can fail in the warehouse's
    // vocabulary. A lead should meet one wording for one rule, wherever it
    // is enforced.
    expect(arrivalFailureMessage(new Error('an inventory item must have a location')))
      .toBe(REQUIRED_LOCATION);
    expect(arrivalFailureMessage(new Error('an arriving quantity must be a whole number, one or more')))
      .toMatch(/אחד או יותר/);
  });

  it('tells a lead who pressed twice what already happened', () => {
    expect(arrivalFailureMessage(new Error('acquisition 7f3a is already registered in the warehouse')))
      .toMatch(/כבר נרשם למחסן/);
  });

  it('keeps "already registered" from swallowing "unknown acquisition"', () => {
    // Both are keyed on messages starting with the word `acquisition`, and the
    // map returns the FIRST prefix that matches. If the broad key were
    // ordered first, a missing row would be reported as one that already
    // arrived — a refusal that sends a lead to look in the warehouse for
    // something that was never there.
    expect(arrivalFailureMessage(new Error('unknown acquisition 7f3a')))
      .toBe('לא מצאנו את הפריט הזה ברשימת הרכש');
  });

  it('never returns a Latin character either', () => {
    for (const thrown of [new Error('duplicate key value'), new Error(''), undefined]) {
      expect(arrivalFailureMessage(thrown)).not.toMatch(/[A-Za-z]/);
    }
  });
});
