import { describe, it, expect } from 'vitest';
import {
  GAP_RANGE, HEIGHT_RANGE, NOT_A_LENGTH, POSITION_RANGE, SIDE_RANGE, parseMetres, readMetres,
} from './metres';

/** The inputs Review Focus #2 names, the way people type them. */
const TYPED = ['2,5', ' 3 ', '3.25', 'abc', '', '0', '-1', '1.234'];

describe('typed metres', () => {
  it('reads a comma as a decimal point and ignores the spaces around a number', () => {
    expect(parseMetres('2,5')).toBe(250);
    expect(parseMetres(' 3 ')).toBe(300);
    expect(parseMetres('3.25')).toBe(325);
    expect(parseMetres('0')).toBe(0);
    expect(parseMetres('-1')).toBe(-100);
    expect(parseMetres('.5')).toBe(50);
  });

  it('counts centimetres digit by digit, so no float creeps in', () => {
    expect(parseMetres('2.55')).toBe(255);
    expect(parseMetres('0,07')).toBe(7);
    expect(parseMetres('-0')).toBe(0);
  });

  it('ignores a direction mark pasted in from a Hebrew document', () => {
    expect(parseMetres('‏2,5')).toBe(250);
  });

  it('reads an empty field as "leave it as it is"', () => {
    expect(parseMetres('')).toBeNull();
    expect(parseMetres('   ')).toBeNull();
  });

  it('refuses what is not a length', () => {
    for (const text of ['abc', '1.234', '2,5,1', '1e3', '+3', '-', '.', '3.', '3 מ׳', '٣']) {
      expect(parseMetres(text)).toBe('invalid');
    }
  });

  it('never answers NaN', () => {
    for (const text of TYPED) {
      const value = parseMetres(text);
      expect(value === null || value === 'invalid' || Number.isInteger(value)).toBe(true);
    }
  });
});

describe('a typed size, checked', () => {
  it('passes the lengths a side can have, and an empty field', () => {
    expect(readMetres('2,5', SIDE_RANGE)).toEqual({ ok: true, cm: 250 });
    expect(readMetres(' 3 ', SIDE_RANGE)).toEqual({ ok: true, cm: 300 });
    expect(readMetres('3.25', SIDE_RANGE)).toEqual({ ok: true, cm: 325 });
    expect(readMetres('', SIDE_RANGE)).toEqual({ ok: true, cm: null });
  });

  it('refuses the rest in Hebrew', () => {
    expect(readMetres('abc', SIDE_RANGE)).toEqual({ ok: false, error: NOT_A_LENGTH });
    expect(readMetres('1.234', SIDE_RANGE)).toEqual({ ok: false, error: NOT_A_LENGTH });
    expect(readMetres('0', SIDE_RANGE)).toEqual({ ok: false, error: 'צריך מספר בין 0.1 ל־500 מטר' });
    expect(readMetres('-1', SIDE_RANGE)).toEqual({ ok: false, error: 'צריך מספר בין 0.1 ל־500 מטר' });
    expect(readMetres('25', HEIGHT_RANGE)).toEqual({ ok: false, error: 'צריך מספר בין 0.1 ל־20 מטר' });
    for (const text of ['abc', '1.234', '0', '-1']) {
      const reading = readMetres(text, SIDE_RANGE);
      if (reading.ok) throw new Error(`"${text}" was accepted as a side`);
      expect(reading.error).toMatch(/[֐-׿]/);
      expect(reading.error).not.toMatch(/[A-Za-z]/);
    }
  });

  it('lets a position run past the fence and a gap be nothing', () => {
    expect(readMetres('-1', POSITION_RANGE)).toEqual({ ok: true, cm: -100 });
    expect(readMetres('0', GAP_RANGE)).toEqual({ ok: true, cm: 0 });
  });
});
