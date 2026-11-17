import { describe, it, expect } from 'vitest';
import {
  ACCESS_LABELS, ACCESS_LEVELS, PAGES, PAGE_KEYS, allows, isAccessLevel, isPageKey,
  levelOf, pageByKey, visiblePages,
} from './pages';

describe('the page registry', () => {
  it('names each page once, under a distinct key and a distinct path', () => {
    expect(new Set(PAGE_KEYS).size).toBe(PAGES.length);
    expect(new Set(PAGES.map((page) => page.href)).size).toBe(PAGES.length);
  });

  it('recognises its own keys and levels, and nothing else', () => {
    expect(isPageKey('people')).toBe(true);
    expect(isPageKey('users')).toBe(false);
    expect(isPageKey(undefined)).toBe(false);
    expect(isAccessLevel('edit')).toBe(true);
    expect(isAccessLevel('none')).toBe(false);
  });

  it('has a Hebrew word for each level and for the absent row', () => {
    for (const level of [...ACCESS_LEVELS, 'none'] as const) {
      expect(ACCESS_LABELS[level]).toMatch(/[א-ת]/);
      expect(ACCESS_LABELS[level]).not.toMatch(/[A-Za-z]/);
    }
  });

  it('finds a page by key', () => {
    expect(pageByKey('ledger')).toMatchObject({ href: '/money/ledger', label: 'תנועות' });
  });
});

describe('levelOf / allows / visiblePages', () => {
  const granted = { admin: false, pages: { people: 'view', dues: 'edit' } } as const;

  it('reads an admin as edit on every page, before any row is asked', () => {
    const admin = { admin: true, pages: {} };
    for (const key of PAGE_KEYS) expect(levelOf(admin, key)).toBe('edit');
    expect(visiblePages(admin)).toEqual(PAGE_KEYS);
  });

  it('reads a granted account row by row, and closed where there is no row', () => {
    expect(levelOf(granted, 'people')).toBe('view');
    expect(levelOf(granted, 'dues')).toBe('edit');
    expect(levelOf(granted, 'money')).toBeNull();
    expect(visiblePages(granted)).toEqual(['people', 'dues']);
  });

  it('reads nobody as closed everywhere', () => {
    expect(levelOf(null, 'home')).toBeNull();
    expect(visiblePages(null)).toEqual([]);
  });

  it('lets edit do what view does, and never the other way round', () => {
    expect(allows('edit', 'view')).toBe(true);
    expect(allows('edit', 'edit')).toBe(true);
    expect(allows('view', 'view')).toBe(true);
    expect(allows('view', 'edit')).toBe(false);
    expect(allows(null, 'view')).toBe(false);
  });

  it('keeps the rail order when listing what is open', () => {
    const scrambled = { admin: false, pages: { upload: 'view', home: 'view', ledger: 'edit' } } as const;
    expect(visiblePages(scrambled)).toEqual(['home', 'ledger', 'upload']);
  });
});
