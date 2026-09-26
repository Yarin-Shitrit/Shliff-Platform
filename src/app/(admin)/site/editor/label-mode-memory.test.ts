/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { keepLabelMode, readLabelMode } from './label-mode-memory';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('the labels style this browser chose last', () => {
  it('is nothing on a first visit', () => {
    expect(readLabelMode()).toBeNull();
  });

  it('is what was kept', () => {
    keepLabelMode('printed');
    expect(readLabelMode()).toBe('printed');
    keepLabelMode('none');
    expect(readLabelMode()).toBe('none');
  });

  it('is nothing when what is kept is not a style', () => {
    window.localStorage.setItem('shliff.site.labels', 'true');
    expect(readLabelMode()).toBeNull();
  });

  it('is nothing, and keeping throws nothing, where storage refuses', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(readLabelMode()).toBeNull();
    expect(() => { keepLabelMode('printed'); }).not.toThrow();
  });
});
