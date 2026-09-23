import { describe, it, expect } from 'vitest';
import { HEBREW_FALLBACK } from '@/lib/errors/hebrew';
import { SITE_ERRORS, siteFailureMessage } from './failure-messages';

describe('site failure messages', () => {
  it('names each refusal the library makes, in Hebrew', () => {
    expect(siteFailureMessage(new Error('this season already has a map')))
      .toBe('לשנה הזו כבר יש מפה. אפשר לערוך אותה, לא ליצור שנייה');
    expect(siteFailureMessage(new Error('unknown site item 7f3a')))
      .toBe('לא מצאנו את הפריט הזה במפה — אולי הוסר בינתיים');
    expect(siteFailureMessage(new Error('that task is not a build task of this season')))
      .toBe('אפשר לקשר רק משימת הקמה של השנה הזו');
  });

  it('carries no Latin letter in any mapped sentence', () => {
    for (const [, hebrew] of SITE_ERRORS) expect(hebrew).not.toMatch(/[A-Za-z]/);
  });

  it('falls back to Hebrew rather than echoing an English message', () => {
    const message = siteFailureMessage(new Error('ECONNREFUSED 127.0.0.1:5433'));
    expect(message).toBe(HEBREW_FALLBACK);
    expect(message).not.toMatch(/[A-Za-z]/);
  });

  it('never returns a Latin character, whatever it is handed', () => {
    for (const thrown of [
      new Error('relation "site_items" does not exist'),
      new Error(''),
      'not an error at all',
      undefined,
    ]) {
      expect(siteFailureMessage(thrown)).not.toMatch(/[A-Za-z]/);
    }
  });
});
