/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Season } from '@/lib/members/roster';

/**
 * The rail is an async Server Component, so it is awaited and its output
 * rendered. What this file checks is the wiring the rail alone owns: that
 * each season's stored gate date reaches the switcher, and that the drawer
 * which edits it is mounted beside `NewSeasonDrawer` and fed the same list.
 * The rail's other islands have their own tests and are stubbed out here.
 */
const route = vi.hoisted(() => ({ pathname: '/fees', search: '' }));
const seasonsRef = vi.hoisted(() => ({ current: [] as Season[] }));

vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/seasons/current', () => ({
  resolveSeason: async () => ({ seasons: seasonsRef.current, current: seasonsRef.current[0] ?? null }),
}));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin: async () => ({ ok: false }) }));
vi.mock('./actions', () => ({
  signOutAction: vi.fn(),
  createSeasonAction: vi.fn(),
  setSeasonStartsOnAction: vi.fn(),
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
vi.mock('./command-palette', () => ({ CommandPalette: () => null }));
vi.mock('./nav-list', () => ({ NavList: () => null }));

import { Sidebar } from './sidebar';

function row(over: Partial<Season>): Season {
  return {
    id: 'b26', name: 'ברן 26', year: 2026, flatRate: '1200.00', plannedSize: null, startsOn: null,
    ...over,
  };
}

describe('Sidebar — the gate date', () => {
  beforeEach(() => {
    route.pathname = '/fees';
    route.search = '';
    // 22:30 UTC on 3 June is 4 June in Israel.
    seasonsRef.current = [
      row({ id: 'b26', name: 'ברן 26', startsOn: new Date('2026-06-03T22:30:00Z') }),
      row({ id: 'b25', name: 'ברן 25', year: 2025 }),
    ];
  });

  it("hands each season's stored date to the switcher", async () => {
    render(await Sidebar());
    fireEvent.click(screen.getByRole('button', { name: /ברן 26/ }));
    expect(screen.getByRole('link', { name: /פתיחת השער/ }).textContent).toContain('4 ביוני 2026');
  });

  it('mounts the drawer that edits it, fed the same seasons', async () => {
    route.search = 'act=season-date';
    render(await Sidebar());
    expect(screen.getByRole('dialog', { name: 'פתיחת השער' })).toBeTruthy();
    expect((screen.getByLabelText('תאריך הפתיחה') as HTMLInputElement).value).toBe('2026-06-04');
  });
});
