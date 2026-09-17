'use client';

/**
 * A client component because it is a switch: it writes the cookie and flips
 * `data-theme` on <html> in the browser, so the palette changes on the click
 * rather than on a round trip. There is no server action here — the value is
 * a display preference, nothing reads it but CSS, and a navigation to change
 * a colour is a navigation nobody asked for.
 *
 * It holds no React state. The attribute on <html> *is* the state: the server
 * wrote it from the cookie for the first paint, and this button writes it
 * afterwards. Keeping a copy in a hook would be a second source of truth that
 * a soft navigation could put out of step.
 */

import { Icon } from './icon';
import { parseTheme, THEME_COOKIE, THEME_MAX_AGE_SECONDS, type Theme } from '@/lib/theme';
import styles from './theme-toggle.module.css';

/**
 * What the reader is looking at right now: their choice if they made one, and
 * otherwise whatever their OS asked for — which is what the guarded
 * `prefers-color-scheme` rule in tokens.css is showing them.
 */
function shownTheme(): Theme {
  const chosen = parseTheme(document.documentElement.dataset.theme);
  if (chosen) return chosen;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeToggle() {
  function flip() {
    const next: Theme = shownTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.cookie =
      `${THEME_COOKIE}=${next}; path=/; max-age=${THEME_MAX_AGE_SECONDS}; samesite=lax`;
  }

  return (
    <div className={styles.row}>
      <button
        type="button"
        className={styles.button}
        onClick={flip}
        aria-label="החלפת ערכת צבעים"
      >
        {/*
          Both glyphs ship and the stylesheet shows exactly one. The server
          cannot know the reader's OS preference, so choosing the glyph in JSX
          would mean guessing it — and a moon on a dark page is the guess
          being wrong in the first paint.
        */}
        <span className={styles.whenLight}><Icon name="moon" size={16} /></span>
        <span className={styles.whenDark}><Icon name="sun" size={16} /></span>
      </button>
    </div>
  );
}
