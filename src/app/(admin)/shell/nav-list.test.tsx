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

  /**
   * The old version rendered once with the zero-count fixture already in
   * place and asserted `queryByText('0')` is null under `waitFor` — which is
   * satisfied on the very first tick, before the mocked `loadShellCounts`
   * promise even settles. It measures the initial (pre-load) empty state,
   * which looks identical no matter what the action returns, so it cannot
   * fail no matter how `badge()` is wired.
   *
   * This instead loads a positive count first and waits for it to actually
   * render, then drives a real second load (a pathname change, same as the
   * "refreshes counts" test below) that resolves to all zeros, and asserts
   * the count disappears only after that load lands.
   */
  it('shows no count only once a real load reads every count as zero (B2)', async () => {
    counts.value = { openDecisions: 0, rosterSize: 38, understaffedTasks: 0 };
    const { rerender } = render(<NavList />);
    await waitFor(() => expect(screen.getByText('38')).toBeTruthy());

    counts.value = { openDecisions: 0, rosterSize: 0, understaffedTasks: 0 };
    route.pathname = '/fees';
    rerender(<NavList />);

    await waitFor(() => expect(screen.queryByText('38')).toBeNull());
    expect(screen.queryByText('0')).toBeNull();
  });

  it('shows each count once it is actionable', async () => {
    counts.value = { openDecisions: 12, rosterSize: 38, understaffedTasks: 6 };
    render(<NavList />);
    await waitFor(() => expect(screen.getByText('12')).toBeTruthy());
    expect(screen.getByText('38')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
  });

  it('refreshes counts after a soft navigation, even within the same season', async () => {
    counts.value = { openDecisions: 0, rosterSize: 3, understaffedTasks: 0 };
    const { rerender } = render(<NavList />);
    await waitFor(() => expect(screen.getByText('3')).toBeTruthy());

    // A write on another page (add a person) changes what the next fetch
    // would return; a soft navigation is the cheapest observable sign of it,
    // with `season` unchanged. counts.ts: "a count in the chrome that
    // disagrees with the page it links to is worse than no count."
    counts.value = { openDecisions: 0, rosterSize: 9, understaffedTasks: 0 };
    route.pathname = '/fees';
    rerender(<NavList />);

    await waitFor(() => expect(screen.getByText('9')).toBeTruthy());
    expect(screen.queryByText('3')).toBeNull();
  });
});
