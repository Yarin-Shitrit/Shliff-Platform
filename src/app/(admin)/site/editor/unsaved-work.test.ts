/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetUnsaved, isStaleBuild, keepUnsaved, readUnsaved } from './unsaved-work';

const MOVE = { type: 'update', id: 'a', patch: { xCm: 550 } } as const;

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('work an older build left unsaved', () => {
  it('knows Next’s missing server action from a dropped connection', () => {
    const named = Object.assign(new Error('Server Action "7f" was not found on the server.'), { name: 'UnrecognizedActionError' });
    expect(isStaleBuild(named)).toBe(true);
    // The name can be lost crossing a boundary; the sentence is Next's own.
    expect(isStaleBuild(new Error('Server Action "7f" was not found on the server. \nRead more: …'))).toBe(true);
    expect(isStaleBuild(new TypeError('Failed to fetch'))).toBe(false);
    expect(isStaleBuild('Server Action "7f" was not found on the server.')).toBe(false);
  });

  it('keeps it per plan, reads it back, and forgets it', () => {
    keepUnsaved('p1', [MOVE]);
    expect(readUnsaved('p1')).toEqual([MOVE]);
    expect(readUnsaved('p2')).toEqual([]);
    forgetUnsaved('p1');
    expect(readUnsaved('p1')).toEqual([]);
    keepUnsaved('p1', [MOVE]);
    keepUnsaved('p1', []);
    expect(window.sessionStorage.getItem('site-editor:pending:p1')).toBeNull();
  });

  it('reads nothing back rather than half of something it cannot trust', () => {
    window.sessionStorage.setItem('site-editor:pending:p1', '{not json');
    expect(readUnsaved('p1')).toEqual([]);
    window.sessionStorage.setItem('site-editor:pending:p1', JSON.stringify({ type: 'update' }));
    expect(readUnsaved('p1')).toEqual([]);
    // One op the server would refuse spoils the batch: none of it is replayed.
    window.sessionStorage.setItem('site-editor:pending:p1', JSON.stringify([MOVE, { type: 'update', id: 'b', patch: { widthCm: 5 } }]));
    expect(readUnsaved('p1')).toEqual([]);
    window.sessionStorage.setItem('site-editor:pending:p1', JSON.stringify([MOVE, { type: 'teleport', id: 'c' }]));
    expect(readUnsaved('p1')).toEqual([]);
  });

  it('carries on without storage — a private window, or blocked site data', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => { keepUnsaved('p1', [MOVE]); }).not.toThrow();
    expect(readUnsaved('p1')).toEqual([]);
  });
});
