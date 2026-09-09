import { describe, it, expect } from 'vitest';
import { termMatches, tokenize } from '@/lib/classify/match';

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('סוג הוצאה')).toEqual(new Set(['סוג', 'הוצאה']));
  });

  it('splits on a slash, which separates words in these sheets', () => {
    expect(tokenize('מזומן/אשראי')).toEqual(new Set(['מזומן', 'אשראי']));
    expect(tokenize('פירוט/תיאור תנועה')).toEqual(new Set(['פירוט', 'תיאור', 'תנועה']));
  });

  it('preserves internal quotes, which are part of the word', () => {
    expect(tokenize('סה"כ')).toEqual(new Set(['סה"כ']));
    expect(tokenize('עו"ש')).toEqual(new Set(['עו"ש']));
  });

  it('strips edge punctuation', () => {
    expect(tokenize('(עו"ש)')).toEqual(new Set(['עו"ש']));
    expect(tokenize('ספק,')).toEqual(new Set(['ספק']));
  });
});

describe('termMatches', () => {
  it('matches a single-word term only as a whole token', () => {
    expect(termMatches('ביט', 'ביט')).toBe(true);
    expect(termMatches('ביט', 'ביטים')).toBe(false);
    expect(termMatches('שם', 'בושם')).toBe(false);
    expect(termMatches('ספק', 'אספקה')).toBe(false);
  });

  it('recovers slash-glued terms', () => {
    expect(termMatches('פירוט', 'פירוט/תיאור תנועה')).toBe(true);
    expect(termMatches('מזומן', 'מזומן/אשראי')).toBe(true);
  });

  it('matches a multi-word term by substring', () => {
    expect(termMatches('כמות יחידות', 'כמות יחידות בפועל')).toBe(true);
  });

  it('does not match a Hebrew conjunctive prefix glued to a term', () => {
    // Deliberate: stripping single-letter prefixes would reintroduce the
    // false-positive class that whole-token matching just eliminated.
    expect(termMatches('וייבז', 'ווייבז')).toBe(false);
  });
});
