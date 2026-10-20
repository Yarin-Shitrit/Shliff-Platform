import { describe, it, expect, vi } from 'vitest';
import {
  typeFailureMessage, slotFailureMessage, assignFailureMessage, TYPE_ERRORS, SLOT_ERRORS,
  OUTSIDE_WINDOW,
} from './failure-messages';

describe('shift failures reach the screen in Hebrew', () => {
  it('maps every refusal the library throws', () => {
    expect(typeFailureMessage(new Error('a shift type needs a name'))).toMatch(/שם/);
    expect(typeFailureMessage(new Error('a shift type with that name already exists'))).toBe('כבר יש סוג משמרת בשם הזה');
    expect(slotFailureMessage(new Error('a shift lies outside the event window'))).toBe(OUTSIDE_WINDOW);
    expect(slotFailureMessage(new Error('unknown shift 1234'))).toBe('לא מצאנו את המשמרת הזו בלוח');
    expect(slotFailureMessage(new Error('unknown shift type 1234'))).toBe('לא מצאנו את סוג המשמרת הזה');
    expect(slotFailureMessage(new Error('the season has no gate date'))).toMatch(/פתיחת השער/);
    expect(assignFailureMessage(new Error('that person was merged into another'))).toMatch(/מוזג/);
  });

  it('says the event edges in the refusal, so a lead knows what to change', () => {
    expect(OUTSIDE_WINDOW).toContain('16:00');
    expect(OUTSIDE_WINDOW).toContain('12:00');
  });

  it('never echoes English, whatever it is given', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const raw = new Error('connect ECONNREFUSED 127.0.0.1:5433');
    for (const message of [typeFailureMessage(raw), slotFailureMessage(raw), assignFailureMessage(raw)]) {
      expect(message).not.toMatch(/[A-Za-z]/);
    }
    expect(typeFailureMessage('not even an error')).not.toMatch(/[A-Za-z]/);
    log.mockRestore();
  });

  it('keeps every map entry in Hebrew with an English prefix', () => {
    for (const [prefix, hebrew] of [...TYPE_ERRORS, ...SLOT_ERRORS]) {
      expect(prefix).toMatch(/^[a-z]/);
      expect(hebrew).not.toMatch(/[A-Za-z]/);
    }
  });
});
