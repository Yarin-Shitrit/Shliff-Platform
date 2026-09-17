import { describe, it, expect, vi, afterEach } from 'vitest';
import { toHebrewError, HEBREW_FALLBACK, type HebrewErrors } from './hebrew';

const MAP: HebrewErrors = [
  ['an exception must carry a reason', 'חריג חייב לכלול סיבה.'],
  ['unknown payment channel', 'אמצעי התשלום הזה לא מוכר.'],
];

describe('toHebrewError', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('maps a listed English message to its Hebrew', () => {
    expect(toHebrewError(new Error('an exception must carry a reason'), MAP))
      .toBe('חריג חייב לכלול סיבה.');
  });

  it('matches by prefix, so an interpolated id does not break the mapping', () => {
    expect(toHebrewError(new Error('unknown payment channel: מזומן'), MAP))
      .toBe('אמצעי התשלום הזה לא מוכר.');
  });

  it('passes through a message that is already Hebrew', () => {
    const hebrew = 'קיזוז אינו מזיז מזומן, ולכן אינו נכנס לחשבון';
    expect(toHebrewError(new Error(hebrew), MAP)).toBe(hebrew);
  });

  it('renders the generic Hebrew fallback for an unmapped English message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toHebrewError(new Error('duplicate key value violates unique constraint'), MAP))
      .toBe(HEBREW_FALLBACK);
  });

  it('logs the unmapped message rather than showing it', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    toHebrewError(new Error('connection terminated unexpectedly'), MAP);
    expect(logged).toHaveBeenCalledWith(
      'unmapped server error', 'connection terminated unexpectedly',
    );
  });

  it('falls back for a thrown value that is not an Error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toHebrewError({ code: 42 }, MAP)).toBe(HEBREW_FALLBACK);
  });
});
