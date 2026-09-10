/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/data',
}));

import { Nav } from '@/app/(admin)/nav';

describe('Nav', () => {
  it('links to the sections that are built', () => {
    render(<Nav />);
    expect(screen.getByRole('link', { name: 'נתונים' })).toHaveProperty('href');
    expect(screen.getByRole('link', { name: 'ייבוא' })).toHaveProperty('href');
  });

  it('marks the current section for assistive technology', () => {
    render(<Nav />);
    expect(screen.getByRole('link', { name: 'נתונים' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'ייבוא' }).getAttribute('aria-current')).toBeNull();
  });

  it('leaves nothing marked בקרוב now that every section is built', () => {
    render(<Nav />);
    // The `planned` branch stays in nav.tsx for future sections, but no
    // section uses it today — a built page behind a בקרוב badge is worse
    // than not shipping it.
    expect(screen.queryByText('בקרוב')).toBeNull();
  });

  it.each([
    ['חברי מחנה', '/members'],
    ['דמי קאמפ', '/fees'],
    ['משימות', '/tasks'],
  ])('links %s now that the section is built', (label, href) => {
    render(<Nav />);
    // Flipped ahead of Task 15: these pages exist and render real data, and a
    // built section left behind a בקרוב badge is worse than not shipping it.
    expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe(href);
  });
});
