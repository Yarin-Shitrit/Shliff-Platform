import { describe, it, expect } from 'vitest';
import { HEBREW_FALLBACK } from '@/lib/errors/hebrew';
import { SITE_ERRORS, siteFailureMessage } from './failure-messages';
import { LOCKED_NOTICE } from './editor/notices';

describe('site failure messages', () => {
  it('names each refusal the library makes, in Hebrew', () => {
    expect(siteFailureMessage(new Error('this season already has a map')))
      .toBe('לשנה הזו כבר יש מפה. אפשר לערוך אותה, לא ליצור שנייה');
    expect(siteFailureMessage(new Error('unknown site item 7f3a')))
      .toBe('לא מצאנו את הפריט הזה במפה — אולי הוסר בינתיים');
    expect(siteFailureMessage(new Error('that task is not a build task of this season')))
      .toBe('אפשר לקשר רק משימת הקמה של השנה הזו');
    // One sentence for a locked item, wherever it is said (ruling P14).
    expect(siteFailureMessage(new Error('that item is locked'))).toBe(LOCKED_NOTICE);
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

  it('says every new editor refusal in Hebrew', () => {
    for (const english of [
      'an item id must be a uuid',
      'an item id is already in use',
      'an item height must be a whole number of centimetres between 10 and 2000',
      'a lock must be true or false',
      'that item is locked',
      'a kind default must be whole centimetres: sides 10 to 50000, height 10 to 2000',
      'north must be a whole number of degrees from 0 to 359',
      'unknown operation',
      'an item sort must be a whole number, zero or more',
    ]) {
      const hebrew = siteFailureMessage(new Error(english));
      expect(hebrew).not.toBe(HEBREW_FALLBACK);
      expect(hebrew).toMatch(/[֐-׿]/);
      expect(hebrew).not.toMatch(/[A-Za-z]/);
    }
  });

  it('says the image’s three refusals in Hebrew, in the spec’s words', () => {
    expect(siteFailureMessage(new Error('an underlay file must be one uploaded to this map')))
      .toBe('קובץ תמונת הרקע לא שייך למפה הזו. טעינה מחדש של המפה תסדר את זה');
    expect(siteFailureMessage(new Error('an underlay file must be a png, jpeg or webp image uploaded to a map')))
      .toBe('קובץ תמונת הרקע לא שייך למפה הזו. טעינה מחדש של המפה תסדר את זה');
    expect(siteFailureMessage(new Error('an underlay placement must be whole centimetres and tenths of a degree')))
      .toBe('מיקום תמונת הרקע נמדד במספר שלם של סנטימטרים');
    expect(siteFailureMessage(new Error('an underlay calibration must be two points on the image and a distance of 10 cm to 500 m')))
      .toBe('הכיול של תמונת הרקע לא נשמר כמו שצריך. אפשר לכייל שוב');
    expect(siteFailureMessage(new Error('an underlay file name must be at most 200 characters')))
      .toBe('שם הקובץ של תמונת הרקע ארוך מדי — עד 200 תווים');
  });
});
