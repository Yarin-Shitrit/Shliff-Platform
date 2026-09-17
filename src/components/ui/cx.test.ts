import { describe, it, expect } from 'vitest';
import { cx } from './cx';

describe('cx', () => {
  it('joins the truthy parts with a single space', () => {
    expect(cx('btn', 'primary')).toBe('btn primary');
  });

  it('drops false, null and undefined so a variant can be conditional', () => {
    expect(cx('btn', false, null, undefined, 'sm')).toBe('btn sm');
  });

  it('returns an empty string when nothing survives', () => {
    expect(cx(false, undefined)).toBe('');
  });
});
