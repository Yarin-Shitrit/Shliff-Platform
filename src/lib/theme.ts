/**
 * The theme choice, in the one place the server and the browser both read it.
 *
 * This module imports nothing. `next/headers` must never enter it: the client
 * toggle imports `THEME_COOKIE` from here, and pulling a server-only module
 * into the client bundle through a shared constant is a build error waiting
 * for the first person who adds one.
 */

export const THEME_COOKIE = 'shliff_theme';

/** A year. The choice is a preference, not a session. */
export const THEME_MAX_AGE_SECONDS = 31_536_000;

export type Theme = 'light' | 'dark';

/** Anything that is not one of the two themes means the OS decides (A13). */
export function parseTheme(value: string | undefined | null): Theme | null {
  return value === 'light' || value === 'dark' ? value : null;
}
