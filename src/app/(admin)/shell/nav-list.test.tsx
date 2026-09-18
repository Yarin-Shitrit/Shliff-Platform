/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const route = vi.hoisted(() => ({ pathname: '/', season: null as string | null }));
const counts = vi.hoisted(() => ({
  value: { openDecisions: 0, rosterSize: 0, understaffedTasks: 0 },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.season ? `season=${route.season}` : ''),
}));

vi.mock('@/app/(admin)/shell/actions', () => ({
  loadShellCounts: async () => counts.value,
}));

import { NavList } from '@/app/(admin)/shell/nav-list';

describe('NavList', () => {
  beforeEach(() => {
    route.pathname = '/';
    route.season = null;
    counts.value = { openDecisions: 0, rosterSize: 0, understaffedTasks: 0 };
  });

  it('lists B1 sections under B1 group headings', () => {
    render(<NavList />);
    for (const label of ['הקאמפ', 'כספים', 'נתונים']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: /אנשים/ }).getAttribute('href')).toBe('/members');
    expect(screen.getByRole('link', { name: /דמי קאמפ/ }).getAttribute('href')).toBe('/fees');
    expect(screen.getByRole('link', { name: /סקירה כספית/ }).getAttribute('href')).toBe('/money');
  });

  it('keeps a person page inside אנשים (B3)', () => {
    route.pathname = '/members/6f1c0e0e-0000-4000-8000-000000000000';
    render(<NavList />);
    expect(screen.getByRole('link', { name: /אנשים/ }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: /דמי קאמפ/ }).getAttribute('aria-current')).toBeNull();
  });

  it('shows a route that does not exist yet as בקרוב, never as a link', () => {
    render(<NavList />);
    expect(screen.queryByRole('link', { name: /לטיפול/ })).toBeNull();
    expect(screen.getByText('לטיפול')).toBeTruthy();
    expect(screen.getAllByText('בקרוב').length).toBeGreaterThan(0);
  });

  it('shows no count while every count reads zero (B2)', async () => {
    render(<NavList />);
    await waitFor(() => expect(screen.queryByText('0')).toBeNull());
  });

  it('shows each count once it is actionable', async () => {
    counts.value = { openDecisions: 12, rosterSize: 38, understaffedTasks: 6 };
    render(<NavList />);
    await waitFor(() => expect(screen.getByText('12')).toBeTruthy());
    expect(screen.getByText('38')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
  });
});
