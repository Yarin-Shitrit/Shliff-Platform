/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from '@/components/theme-toggle';

function stubPrefersDark(prefersDark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-color-scheme: dark)' ? prefersDark : false,
    media: query,
  }));
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.cookie = 'shliff_theme=; path=/; max-age=0';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('turns a chosen light theme dark, on the page and in the cookie', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'החלפת ערכת צבעים' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.cookie).toContain('shliff_theme=dark');
  });

  it('turns a chosen dark theme light', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'החלפת ערכת צבעים' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.cookie).toContain('shliff_theme=light');
  });

  /**
   * With no cookie the page is showing whatever the OS asked for, so the
   * first click has to turn *that* around — not the value the markup guessed.
   */
  it('turns the OS preference around when nobody has chosen yet', () => {
    stubPrefersDark(true);
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'החלפת ערכת צבעים' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.cookie).toContain('shliff_theme=light');
  });

  it('turns a light OS preference around the other way', () => {
    stubPrefersDark(false);
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'החלפת ערכת צבעים' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.cookie).toContain('shliff_theme=dark');
  });

  /**
   * Both glyphs are in the markup and the stylesheet shows one, so the icon
   * is correct in the first paint without the server knowing the reader's OS.
   */
  it('renders both faces of the switch, and names itself in Hebrew', () => {
    const { container } = render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'החלפת ערכת צבעים' })).toBeDefined();
    expect(container.querySelectorAll('svg')).toHaveLength(2);
  });
});
