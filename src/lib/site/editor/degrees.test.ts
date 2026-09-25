import { describe, it, expect } from 'vitest';
import {
  MAX_ROPE_ANGLE_DEG, MIN_ROPE_ANGLE_DEG, NOT_WHOLE_DEGREES, ROPE_ANGLE_OUT_OF_RANGE, isRopeAngle, readDegrees,
} from './degrees';

/** Everything a lead might type into the box, including what spec §22 names. */
const TYPED = ['45', ' 45° ', '45.5', '', 'abc', '19', '81', '‏45', '20', '80', '-30', '45,5', '+45'];

describe('typed rope angles', () => {
  it('reads whole degrees, with spaces and a degree sign around them', () => {
    expect(readDegrees('45')).toEqual({ ok: true, deg: 45 });
    expect(readDegrees(' 45° ')).toEqual({ ok: true, deg: 45 });
    expect(readDegrees('45 °')).toEqual({ ok: true, deg: 45 });
    expect(readDegrees('045')).toEqual({ ok: true, deg: 45 });
  });

  it('ignores a direction mark pasted in from a Hebrew document', () => {
    expect(readDegrees('‏45')).toEqual({ ok: true, deg: 45 });
    expect(readDegrees('⁦45⁩°')).toEqual({ ok: true, deg: 45 });
  });

  it('reads an empty box as "leave it as it is"', () => {
    expect(readDegrees('')).toEqual({ ok: true, deg: null });
    expect(readDegrees('   ')).toEqual({ ok: true, deg: null });
  });

  it('takes both ends of the range, and refuses one past either, in Hebrew', () => {
    expect(readDegrees('20')).toEqual({ ok: true, deg: 20 });
    expect(readDegrees('80')).toEqual({ ok: true, deg: 80 });
    for (const text of ['19', '81', '0', '90', '-30']) {
      expect(readDegrees(text)).toEqual({ ok: false, error: ROPE_ANGLE_OUT_OF_RANGE });
    }
  });

  it('refuses what is not a whole number of degrees', () => {
    for (const text of ['45.5', '45,5', 'abc', '4 5', '45°°', '٤٥', '1e2', '+45']) {
      expect(readDegrees(text)).toEqual({ ok: false, error: NOT_WHOLE_DEGREES });
    }
  });

  it('answers in Hebrew or with a whole number, never NaN and never English', () => {
    for (const text of TYPED) {
      const reading = readDegrees(text);
      if (reading.ok) {
        expect(reading.deg === null || Number.isInteger(reading.deg)).toBe(true);
      } else {
        expect(reading.error).toMatch(/[֐-׿]/);
        expect(reading.error).not.toMatch(/[A-Za-z]/);
      }
    }
  });

  it('keeps the range the spec sets (D17), for the ops and the server too', () => {
    expect([MIN_ROPE_ANGLE_DEG, MAX_ROPE_ANGLE_DEG]).toEqual([20, 80]);
    expect(isRopeAngle(20)).toBe(true);
    expect(isRopeAngle(80)).toBe(true);
    for (const value of [19, 81, 45.5, Number.NaN, '45', null, undefined]) expect(isRopeAngle(value)).toBe(false);
  });
});
