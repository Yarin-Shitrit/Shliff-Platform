import { describe, it, expect } from 'vitest';
import { PEEK_PARAM, openPeekHref, closePeekHref, openActHref } from './drawer-url';

const list = () => new URLSearchParams('season=s-9f2&view=unpaid&sort=balance');

describe('the drawer URL contract', () => {
  it('names the params R6 specifies', () => {
    // `?peek=<id>` is the name R6 gives the spec, so pinning it catches a
    // rename against the spec, not just against this file. `ACT_PARAM` has
    // no such external name to answer to — asserting it against the
    // constant this same file imports would only pin the file against
    // itself, so that half of the check is dropped rather than kept.
    expect(PEEK_PARAM).toBe('peek');
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

describe('openActHref (a create drawer has no record)', () => {
  it('sets act and no peek', () => {
    const url = new URL(openActHref('/tasks', new URLSearchParams(), 'task'), 'https://example.test');
    expect(url.searchParams.get('act')).toBe('task');
    expect(url.searchParams.has('peek')).toBe(false);
  });

  it('drops an existing peek so a create drawer never opens over an open record drawer', () => {
    const current = new URLSearchParams('peek=p-17');
    const url = new URL(openActHref('/fees', current, 'season'), 'https://example.test');
    expect(url.searchParams.has('peek')).toBe(false);
    expect(url.searchParams.get('act')).toBe('season');
  });

  it('carries the season, a saved view and a filter through', () => {
    const current = new URLSearchParams('season=s-9f2&view=unpaid&status=overdue');
    const url = new URL(openActHref('/fees', current, 'season'), 'https://example.test');
    expect(url.searchParams.get('season')).toBe('s-9f2');
    expect(url.searchParams.get('view')).toBe('unpaid');
    expect(url.searchParams.get('status')).toBe('overdue');
    expect(url.searchParams.get('act')).toBe('season');
  });

  it('keeps a repeated param as both values, not just the last one', () => {
    const current = new URLSearchParams('tag=a&tag=b');
    const url = new URL(openActHref('/tasks', current, 'task'), 'https://example.test');
    expect(url.searchParams.getAll('tag')).toEqual(['a', 'b']);
  });
});
