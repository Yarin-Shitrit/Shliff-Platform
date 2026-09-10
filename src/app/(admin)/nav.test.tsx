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

  it('shows planned sections as disabled rather than hiding them', () => {
    render(<Nav />);
    // Planned sections communicate where the product is going; they must be
    // visible but must not be links, so nobody clicks into a dead end.
    const tasks = screen.getByText('משימות');
    expect(tasks.tagName).not.toBe('A');
    expect(tasks.getAttribute('aria-disabled')).toBe('true');
  });

  it.each([
    ['חברי מחנה', '/members'],
    ['דמי קאמפ', '/fees'],
  ])('links %s now that the section is built', (label, href) => {
    render(<Nav />);
    // Flipped ahead of Task 15: these pages exist and render real data, and a
    // built section left behind a בקרוב badge is worse than not shipping it.
    expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe(href);
  });
});
