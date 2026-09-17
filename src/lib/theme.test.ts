import { describe, it, expect } from 'vitest';
import { parseTheme, THEME_COOKIE, THEME_MAX_AGE_SECONDS } from '@/lib/theme';

describe('parseTheme', () => {
  it('reads the two themes there are', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
  });

  /**
   * A cookie is whatever the browser sends. Anything that is not one of the
   * two themes means "nobody chose", which is the OS preference, which is
   * expressed as no attribute at all.
   */
  it('treats anything else as no choice', () => {
    expect(parseTheme(undefined)).toBeNull();
    expect(parseTheme('')).toBeNull();
    expect(parseTheme('DARK')).toBeNull();
    expect(parseTheme('auto')).toBeNull();
    expect(parseTheme('dark; --injected')).toBeNull();
  });

  it('names the cookie once', () => {
    expect(THEME_COOKIE).toBe('shliff_theme');
    expect(THEME_MAX_AGE_SECONDS).toBe(31_536_000);
  });
});
