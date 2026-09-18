import { describe, it, expect } from 'vitest';
import { PEEK_PARAM, ACT_PARAM, openPeekHref, closePeekHref } from './drawer-url';

const list = () => new URLSearchParams('season=s-9f2&view=unpaid&sort=balance');

describe('the drawer URL contract', () => {
  it('names the params R6 specifies', () => {
    expect(PEEK_PARAM).toBe('peek');
    expect(ACT_PARAM).toBe('act');
  });

  it('opens a record without disturbing the list it was opened from', () => {
    const href = openPeekHref('/members', list(), 'p-17');
    const url = new URL(href, 'https://example.test');
    expect(url.pathname).toBe('/members');
    expect(url.searchParams.get('peek')).toBe('p-17');
    expect(url.searchParams.get('season')).toBe('s-9f2');
    expect(url.searchParams.get('view')).toBe('unpaid');
    expect(url.searchParams.get('sort')).toBe('balance');
  });

  it('carries the mode when a screen has more than one drawer', () => {
    const url = new URL(openPeekHref('/fees', list(), 'p-17', 'pay'), 'https://example.test');
    expect(url.searchParams.get('act')).toBe('pay');
  });

  it('replaces a drawer rather than stacking two', () => {
    const first = openPeekHref('/fees', list(), 'p-17', 'pay');
    const second = openPeekHref('/fees', new URL(first, 'https://example.test').searchParams, 'p-18');
    const url = new URL(second, 'https://example.test');
    expect(url.searchParams.getAll('peek')).toEqual(['p-18']);
    expect(url.searchParams.has('act')).toBe(false);
  });

  it('closes by dropping both params and keeping everything else', () => {
    const open = openPeekHref('/fees', list(), 'p-17', 'pay');
    const closed = closePeekHref('/fees', new URL(open, 'https://example.test').searchParams);
    const url = new URL(closed, 'https://example.test');
    expect(url.searchParams.has('peek')).toBe(false);
    expect(url.searchParams.has('act')).toBe(false);
    expect(url.searchParams.get('season')).toBe('s-9f2');
    expect(url.searchParams.get('view')).toBe('unpaid');
  });

  it('closes to a bare path when nothing else was in the URL', () => {
    expect(closePeekHref('/inbox', new URLSearchParams('peek=b-4'))).toBe('/inbox');
  });

  it('round-trips a Hebrew search term', () => {
    const href = openPeekHref('/members', new URLSearchParams('q=רוני'), 'p-17');
    expect(new URL(href, 'https://example.test').searchParams.get('q')).toBe('רוני');
  });
});
