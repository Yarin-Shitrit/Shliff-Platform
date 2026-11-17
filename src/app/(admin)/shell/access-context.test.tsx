/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const route = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/app/(admin)/shell/actions', () => ({
  loadShellCounts: async () => ({ openDecisions: 0, rosterSize: 0, understaffedTasks: 0 }),
}));

import { AccessProvider } from './access-context';
import { NavList } from './nav-list';
import { TabBar } from './tab-bar';
import { ViewOnlyBanner } from './view-only-banner';

function linkNames(root: HTMLElement): string[] {
  return within(root).getAllByRole('link').map((link) => link.textContent?.trim() ?? '');
}

beforeEach(() => { route.pathname = '/'; });

describe('the rail under an access map', () => {
  it('offers an admin every section, the admin-only page included', () => {
    render(<AccessProvider admin pages={{}}><NavList /></AccessProvider>);
    const names = linkNames(screen.getByRole('navigation', { name: 'ניהול' }));
    expect(names).toEqual(['משתמשים והרשאות']);
    expect(screen.getByRole('navigation', { name: 'כספים' })).toBeTruthy();
  });

  it('offers a granted account only the pages it may open, and drops a group with none', () => {
    render(
      <AccessProvider admin={false} pages={{ people: 'view', ledger: 'edit' }}>
        <NavList />
      </AccessProvider>,
    );
    expect(linkNames(screen.getByRole('navigation', { name: 'הקאמפ' }))).toEqual(['אנשים']);
    expect(linkNames(screen.getByRole('navigation', { name: 'כספים' }))).toEqual(['תנועות']);
    expect(screen.queryByRole('navigation', { name: 'לוגיסטיקה' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'ניהול' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'ראשי' })).toBeNull();
  });

  it('opens תקציב with סקירה כספית, since it is an anchor into that page', () => {
    render(<AccessProvider admin={false} pages={{ money: 'view' }}><NavList /></AccessProvider>);
    expect(linkNames(screen.getByRole('navigation', { name: 'כספים' }))).toEqual(['סקירה כספית', 'תקציב']);
  });

  it('offers nothing to an account with no page — the boundary is what explains it', () => {
    render(<AccessProvider admin={false} pages={{}}><NavList /></AccessProvider>);
    expect(screen.queryAllByRole('link')).toEqual([]);
  });

  /**
   * Without a provider the islands read everything as open, so a test of the
   * rail's shape need not describe an account first. The layout always
   * mounts the provider; this is the test-only path, and it is deliberate.
   */
  it('reads everything as open with no provider above it', () => {
    render(<NavList />);
    expect(screen.getByRole('navigation', { name: 'ניהול' })).toBeTruthy();
  });
});

describe('the tab bar under an access map', () => {
  it('draws only the primary tabs the account may open, and keeps the rest behind עוד', () => {
    render(
      <AccessProvider admin={false} pages={{ people: 'view', inbox: 'edit', tasks: 'view' }}>
        <TabBar />
      </AccessProvider>,
    );
    const bar = screen.getByRole('navigation', { name: 'ניווט מהיר' });
    // B7's own order, with the closed tabs (בית, כספים) simply gone.
    expect(linkNames(bar)).toEqual(['אנשים', 'לטיפול']);
    expect(within(bar).getByRole('button', { name: 'עוד' })).toBeTruthy();
  });
});

describe('the צפייה בלבד banner', () => {
  it('says so at the head of a page the account may only read', () => {
    route.pathname = '/members/6f1c0e0e-0000-4000-8000-000000000000';
    render(<AccessProvider admin={false} pages={{ people: 'view' }}><ViewOnlyBanner /></AccessProvider>);
    const banner = screen.getByRole('region', { name: 'הרשאת צפייה בלבד' });
    expect(banner.textContent).toContain('צפייה בלבד');
  });

  it('stays silent where the account may edit, for an admin, and on a page the rail does not own', () => {
    route.pathname = '/fees';
    const { unmount } = render(
      <AccessProvider admin={false} pages={{ dues: 'edit' }}><ViewOnlyBanner /></AccessProvider>,
    );
    expect(screen.queryByRole('region')).toBeNull();
    unmount();

    render(<AccessProvider admin pages={{}}><ViewOnlyBanner /></AccessProvider>);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('opens תקציב read-only when the money page is read-only', () => {
    route.pathname = '/money';
    render(<AccessProvider admin={false} pages={{ money: 'view' }}><ViewOnlyBanner /></AccessProvider>);
    expect(screen.getByRole('region', { name: 'הרשאת צפייה בלבד' })).toBeTruthy();
  });
});
